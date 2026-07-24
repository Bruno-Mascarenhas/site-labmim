"use strict";

const identity = require("./identity");
const pages = require("./pages");
const dataset = require("../../datasets/leal-wrf");
const territory = require("../../territories/es");

module.exports = { ...identity, territory, dataset, pages };
