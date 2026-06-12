'use strict';
const fs = require('fs');
const os = require('os');
const { execSync } = require('child_process');

let lastCpu = null;
function readCpu() {
  const line = fs.readFileSync('/proc/stat', 'utf8').split('\n')[0];
  const p = line.trim().split(/\s+/).slice(1).map(Number);
  const idle = (p[3] || 0) + (p[4] || 0);
  const total = p.reduce((a, b) => a + b, 0);
  return { idle, total };
}
function cpuPercent() {
  let cur;
  try { cur = readCpu(); } catch (e) { return 0; }
  if (!lastCpu) { lastCpu = cur; return 0; }
  const idleD = cur.idle - lastCpu.idle;
  const totalD = cur.total - lastCpu.total;
  lastCpu = cur;
  if (totalD <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((1 - idleD / totalD) * 100)));
}

let lastNet = null;
function netStats() {
  try {
    const lines = fs.readFileSync('/proc/net/dev', 'utf8').split('\n').slice(2);
    let rx = 0, tx = 0;
    for (const l of lines) {
      const m = l.trim().split(/[:\s]+/);
      if (!m[0] || m[0] === 'lo' || m.length < 10) continue;
      rx += Number(m[1]) || 0;
      tx += Number(m[9]) || 0;
    }
    const now = Date.now();
    let rxRate = 0, txRate = 0;
    if (lastNet) {
      const dt = (now - lastNet.t) / 1000;
      if (dt > 0) { rxRate = Math.max(0, (rx - lastNet.rx) / dt); txRate = Math.max(0, (tx - lastNet.tx) / dt); }
    }
    lastNet = { rx, tx, t: now };
    return { rxRate, txRate };
  } catch (e) { return { rxRate: 0, txRate: 0 }; }
}

function memInfo() {
  const total = os.totalmem();
  let available = os.freemem();
  try {
    const m = fs.readFileSync('/proc/meminfo', 'utf8').match(/MemAvailable:\s+(\d+)/);
    if (m) available = Number(m[1]) * 1024;
  } catch (e) { /* fall back to freemem */ }
  const used = total - available;
  return { total, used, free: available, percent: total ? Math.round((used / total) * 100) : 0 };
}

function diskInfo() {
  try {
    const o = execSync('df -P -B1 / | tail -1', { encoding: 'utf8' }).trim().split(/\s+/);
    const total = Number(o[1]), used = Number(o[2]), free = Number(o[3]);
    return { total, used, free, percent: total ? Math.round((used / total) * 100) : 0 };
  } catch (e) { return { total: 0, used: 0, free: 0, percent: 0 }; }
}

async function stats() {
  return {
    cpu: cpuPercent(),
    cores: os.cpus().length,
    load: os.loadavg().map((n) => Number(n.toFixed(2))),
    mem: memInfo(),
    disk: diskInfo(),
    net: netStats(),
    uptime: os.uptime(),
    time: Date.now()
  };
}

function overview() {
  let osName = 'Linux';
  try {
    const m = fs.readFileSync('/etc/os-release', 'utf8').match(/PRETTY_NAME="?([^"\n]+)"?/);
    if (m) osName = m[1];
  } catch (e) { /* ignore */ }
  return {
    hostname: os.hostname(),
    os: osName,
    kernel: os.release(),
    arch: os.arch(),
    cores: os.cpus().length,
    model: (os.cpus()[0] || {}).model || 'unknown',
    node: process.version,
    panel: '1.0.0'
  };
}

module.exports = { stats, overview };
