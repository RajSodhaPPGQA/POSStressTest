'use strict';

class FunctionalAssertionError extends Error {
  constructor(message, expected, actual) {
    super(message);
    this.name = 'FunctionalAssertionError';
    this.expected = expected;
    this.actual = actual;
  }
}

function assertCondition(condition, message, expected, actual) {
  if (!condition) {
    throw new FunctionalAssertionError(message, expected, actual);
  }
}

module.exports = {
  FunctionalAssertionError,
  assertCondition,
};
