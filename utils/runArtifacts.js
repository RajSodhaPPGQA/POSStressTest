'use strict';

const fs = require('fs');
const path = require('path');

let currentRunDir = '';

function pad(v) {
  return String(v).padStart(2, '0');
}

function formatRunStamp(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
}

function initRunArtifacts(baseDir) {
  const rootDir = baseDir || path.join(__dirname, '..', 'logs');
  if (!fs.existsSync(rootDir)) {
    fs.mkdirSync(rootDir, { recursive: true });
  }

  const runDir = path.join(rootDir, formatRunStamp(new Date()));
  fs.mkdirSync(runDir, { recursive: true });
  currentRunDir = runDir;
  return runDir;
}

function getRunDir() {
  if (!currentRunDir) {
    return path.join(__dirname, '..', 'logs');
  }
  return currentRunDir;
}

function resolveRunPath(fileName) {
  return path.join(getRunDir(), fileName || '');
}

module.exports = {
  initRunArtifacts,
  getRunDir,
  resolveRunPath,
};
