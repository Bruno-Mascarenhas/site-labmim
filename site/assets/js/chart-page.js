"use strict";

(function () {
  const EXCEL_UTF8_BOM = "\ufeff";

  const STAMP = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/;
  const COMPACT_STAMP = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/;

  const el = (id) => document.getElementById(id);

  const pad = (value) => String(value).padStart(2, "0");

  function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function decimal(value, digits) {
    if (!Number.isFinite(value)) return "—";
    return new Intl.NumberFormat("pt-BR", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(value);
  }

  function integer(value) {
    if (!Number.isFinite(value)) return "—";
    return new Intl.NumberFormat("pt-BR").format(Math.round(value));
  }

  function percent(fraction, digits = 1) {
    if (!Number.isFinite(fraction)) return "—";
    return `${decimal(fraction * 100, digits)}%`;
  }

  function fade(hex, alpha) {
    const value = parseInt(hex.slice(1), 16);
    return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
  }

  function parseStationTime(text) {
    const value = String(text);
    const parts = STAMP.exec(value) || COMPACT_STAMP.exec(value);
    if (!parts) return NaN;
    return Date.UTC(+parts[1], +parts[2] - 1, +parts[3], +parts[4], +parts[5], parts[6] ? +parts[6] : 0);
  }

  function formatDay(ms) {
    const date = new Date(ms);
    return `${pad(date.getUTCDate())}/${pad(date.getUTCMonth() + 1)}`;
  }

  function formatDayYear(ms) {
    return `${formatDay(ms)}/${new Date(ms).getUTCFullYear()}`;
  }

  function formatHour(ms) {
    return `${pad(new Date(ms).getUTCHours())}h`;
  }

  function formatClock(ms) {
    const date = new Date(ms);
    return `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
  }

  function formatStamp(ms) {
    return `${formatDay(ms)} ${formatClock(ms)}`;
  }

  function formatStampYear(ms) {
    return `${formatDayYear(ms)} ${formatClock(ms)}`;
  }

  function downloadCsv(fileName, rows) {
    const blob = new Blob([`${EXCEL_UTF8_BOM}${rows.join("\n")}\n`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);
  }

  window.labmimChartPage = {
    el,
    node,
    pad,
    decimal,
    integer,
    percent,
    fade,
    parseStationTime,
    formatDay,
    formatDayYear,
    formatHour,
    formatStamp,
    formatStampYear,
    downloadCsv,
  };
})();
