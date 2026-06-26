'use strict';

const fs = require('fs');
const path = require('path');
const { log } = require('./logger');
const { getRunDir } = require('./runArtifacts');

const targetDirs = [
  path.join(__dirname, '..', 'logs'),
  path.join(__dirname, '..', 'screenshots'),
  path.join(__dirname, '..', 'reports'),
  path.join(__dirname, '..', 'diagnostics'),
  path.join(__dirname, '..', 'artifacts'),
  path.join(__dirname, '..', 'Analytics', 'reports')
];

const protectedFiles = [
  'config.json',
  'latest_summary_rapid.json',
  'latest_summary_standard.json',
  'PHASE_WISE_IMPROVEMENT_PLAN.md',
  'PHASE_WISE_NON_BREAKING_IMPROVEMENT_PLAN.md',
  '.gitignore',
  '.gitkeep'
];

/**
 * Parses date stamp out of filename/directory name.
 * Falls back to file birthtime/mtime if no patterns match.
 */
function getItemTimestamp(itemPath, itemName) {
  // 1. Check for YYYY-MM-DD_HH-mm-ss (run folder style)
  let m = /(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})/.exec(itemName);
  if (m) {
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6])).getTime();
  }

  // 2. Check for YYYY-MM-DD_HHMM (report HTML style)
  m = /(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})/.exec(itemName);
  if (m) {
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5])).getTime();
  }

  // 3. Check for YYYY-MM-DD (simple date)
  m = /(\d{4})-(\d{2})-(\d{2})/.exec(itemName);
  if (m) {
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
  }

  // 4. Check for 13-digit Unix timestamp (e.g. error_xxx_1779894111236.png)
  m = /_(\d{13})\./.exec(itemName);
  if (m) {
    return Number(m[1]);
  }

  // Fallback: use filesystem stat modified time
  try {
    const stat = fs.statSync(itemPath);
    return Math.max(stat.mtimeMs, stat.birthtimeMs || 0);
  } catch (e) {
    return Date.now();
  }
}

/**
 * Checks if a given item name and path represents a run folder.
 */
function isRunFolder(itemPath, itemName) {
  try {
    const stat = fs.statSync(itemPath);
    if (!stat.isDirectory()) return false;
    return /^(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})$/.test(itemName) ||
      /^run_(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})$/.test(itemName);
  } catch (e) {
    return false;
  }
}

/**
 * Calculates size of a file or directory recursively.
 */
function getPathSize(itemPath) {
  try {
    const stat = fs.statSync(itemPath);
    if (stat.isFile()) {
      return stat.size;
    }
    if (stat.isDirectory()) {
      let size = 0;
      const files = fs.readdirSync(itemPath);
      for (const file of files) {
        size += getPathSize(path.join(itemPath, file));
      }
      return size;
    }
  } catch (e) { }
  return 0;
}

/**
 * Formats size in bytes into human-readable string.
 */
function formatSize(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Deletes a file or directory recursively.
 * Skips locked files/folders and logs warning on failure.
 */
function deletePath(itemPath) {
  try {
    const stat = fs.statSync(itemPath);
    if (stat.isFile()) {
      fs.unlinkSync(itemPath);
      return true;
    }
    if (stat.isDirectory()) {
      const files = fs.readdirSync(itemPath);
      let allCleared = true;
      for (const file of files) {
        const success = deletePath(path.join(itemPath, file));
        if (!success) {
          allCleared = false;
        }
      }
      if (allCleared) {
        fs.rmdirSync(itemPath);
        return true;
      }
    }
  } catch (e) {
    log("CLEANUP", `Warning: Failed to delete folder ${itemPath}.`);
    return false;
  }
  log("CLEANUP", `Warning: Failed to delete folder ${itemPath}.`);
  return false;
}

/**
 * Delete run folders and artifact files older than maxDays.
 */
function deleteOldRuns(maxDays, allItems, activeRunDir) {
  let freedBytes = 0;
  let deletedFoldersCount = 0;
  const now = Date.now();
  const msLimit = maxDays * 24 * 60 * 60 * 1000;

  for (const item of allItems) {
    if (item.path === activeRunDir || item.path.startsWith(activeRunDir + path.sep)) {
      continue;
    }

    const age = now - item.timestamp;
    if (age > msLimit) {
      const size = getPathSize(item.path);
      const success = deletePath(item.path);
      if (success) {
        freedBytes += size;
        if (item.isFolder) {
          deletedFoldersCount++;
        }
        item.deleted = true;
      }
    }
  }

  return { freedBytes, deletedFoldersCount };
}

/**
 * Limits number of remaining run folders to maxRunFolders.
 */
function enforceFolderLimit(maxRunFolders, allItems, activeRunDir) {
  let freedBytes = 0;
  let deletedFoldersCount = 0;

  // Filter remaining undeleted run folders (excluding active run folder)
  const remainingRunFolders = allItems.filter(item => {
    return item.isFolder &&
      !item.deleted &&
      item.path !== activeRunDir &&
      !item.path.startsWith(activeRunDir + path.sep);
  });

  // Sort newest first
  remainingRunFolders.sort((a, b) => b.timestamp - a.timestamp);

  // The active run folder is always retained. So the allowed number of past run folders
  // is (maxRunFolders - 1) if the active folder is counted as a run folder.
  const isCurrentlyActiveFolderARunFolder = activeRunDir && isRunFolder(activeRunDir, path.basename(activeRunDir));
  const allowedPastFolders = isCurrentlyActiveFolderARunFolder ? Math.max(0, maxRunFolders - 1) : maxRunFolders;

  if (remainingRunFolders.length > allowedPastFolders) {
    const foldersToDelete = remainingRunFolders.slice(allowedPastFolders);
    for (const folder of foldersToDelete) {
      const size = getPathSize(folder.path);
      const success = deletePath(folder.path);
      if (success) {
        freedBytes += size;
        deletedFoldersCount++;
        folder.deleted = true;
      }
    }
  }

  return { freedBytes, deletedFoldersCount };
}

/**
 * Main entry point for artifact retention policy.
 * Scans directories, applies rules based on configuration, and logs summary.
 */
async function cleanupArtifacts() {
  // Load configuration dynamically
  let config = {};
  try {
    config = require('../config.json');
  } catch (err) {
    log("WARN", `Cleanup skipped: Failed to read config.json: ${err.message}`);
    return;
  }

  const retention = config.retention || {};
  if (retention.enabled !== true) {
    return;
  }

  log("CLEANUP", "Starting artifact cleanup...");

  const logsRoot = path.resolve(path.join(__dirname, '..', 'logs'));
  const rawRunDir = path.resolve(getRunDir());
  // Normalize drive casing on Windows before comparison
  const activeRunDir = (rawRunDir.toLowerCase() === logsRoot.toLowerCase()) ? null : rawRunDir;
  const allItems = [];

  // 1. Gather files/folders from target directories
  for (const dirPath of targetDirs) {
    if (!fs.existsSync(dirPath)) continue;
    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.resolve(path.join(dirPath, entry.name));

        // Skip protected static files and git files
        if (protectedFiles.includes(entry.name) || entry.name.startsWith('.git')) {
          continue;
        }

        // Skip active run directory
        if (activeRunDir && (fullPath === activeRunDir || fullPath.startsWith(activeRunDir + path.sep))) {
          continue;
        }

        const isFolder = isRunFolder(fullPath, entry.name);
        const timestamp = getItemTimestamp(fullPath, entry.name);

        allItems.push({
          path: fullPath,
          name: entry.name,
          isFolder,
          timestamp,
          deleted: false
        });
      }
    } catch (e) {
      log("WARN", `Failed to read target directory ${dirPath}: ${e.message}`);
    }
  }

  let totalFreed = 0;
  let totalDeletedFolders = 0;

  // 2. Age-based cleanup (Rule 1) - only if maxDays config is defined
  const maxDays = Number(retention.maxDays);
  if (Number.isFinite(maxDays) && maxDays > 0) {
    const ageResult = deleteOldRuns(maxDays, allItems, activeRunDir);
    totalFreed += ageResult.freedBytes;
    totalDeletedFolders += ageResult.deletedFoldersCount;
  }

  // 3. Count-based cleanup (Rule 2) - only if maxRunFolders config is defined
  const maxRunFolders = Number(retention.maxRunFolders);
  if (Number.isFinite(maxRunFolders) && maxRunFolders > 0) {
    const countResult = enforceFolderLimit(maxRunFolders, allItems, activeRunDir);
    totalFreed += countResult.freedBytes;
    totalDeletedFolders += countResult.deletedFoldersCount;
  }

  // 4. Count retained folders
  const retainedRunFolders = allItems.filter(item => {
    return item.isFolder &&
      !item.deleted &&
      (!activeRunDir || (item.path !== activeRunDir && !item.path.startsWith(activeRunDir + path.sep)));
  });

  // Retained folders count should include the currently active run folder
  // which is also a run folder.
  const isCurrentlyActiveFolderARunFolder = activeRunDir && isRunFolder(activeRunDir, path.basename(activeRunDir));
  const retainedCount = retainedRunFolders.length + (isCurrentlyActiveFolderARunFolder ? 1 : 0);

  // 5. Output required logging summaries
  log("CLEANUP", `Deleted ${totalDeletedFolders} old run folders.`);
  log("CLEANUP", `Freed ${formatSize(totalFreed)} disk space.`);
  log("CLEANUP", `Retained ${retainedCount} latest runs.`);
  log("CLEANUP", "Cleanup completed successfully.");
}

module.exports = {
  cleanupArtifacts,
  deleteOldRuns,
  enforceFolderLimit,
  calculateFreedSpace: getPathSize // Export matching function name
};
