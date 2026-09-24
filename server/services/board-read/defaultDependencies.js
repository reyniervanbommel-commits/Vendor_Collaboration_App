'use strict';

const { createBoardReadService } = require('./createBoardReadService');

function createProductionBoardReadService() {
  const tableData = require('../TableDataService');
  return createBoardReadService({
    readExecute: tableData.executeBoardRead,
    readRowDetails: tableData.executeReadRowDetails,
    getRevision: tableData.executeGetRevision,
  });
}

module.exports = { createProductionBoardReadService };
