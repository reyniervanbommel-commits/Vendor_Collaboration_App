'use strict';

const { createInflightRead } = require('./read');

function createBoardReadService({ readExecute, readRowDetails, getRevision }) {
  if (typeof readExecute !== 'function') {
    throw new Error('createBoardReadService requires readExecute');
  }
  return {
    read: createInflightRead(readExecute),
    readRowDetails,
    getRevision,
  };
}

module.exports = { createBoardReadService };
