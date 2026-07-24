"use strict";

const identity = require("./identity");
const pages = require("./pages");
const dataset = require("../../datasets/labmim-wrf");
const territory = require("../../territories/ba");

module.exports = { ...identity, territory, dataset, pages };
