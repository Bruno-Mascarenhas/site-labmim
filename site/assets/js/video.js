/**
 * video.js — Video playback controls
 */

const MIN_RATE = 0.25;
const MAX_RATE = 16;

function playPause(videoId) {
  const video = document.getElementById("vid" + videoId);
  if (video.paused) {
    video.play();
  } else {
    video.pause();
  }
}

function fast(videoId) {
  const video = document.getElementById("vid" + videoId);
  const velInput = document.getElementById("vel" + videoId);
  if (video.defaultPlaybackRate < MAX_RATE) {
    video.defaultPlaybackRate = Math.min(video.defaultPlaybackRate + 1, MAX_RATE);
  }
  velInput.value = video.defaultPlaybackRate;
  video.playbackRate = video.defaultPlaybackRate;
  video.play();
}

function slow(videoId) {
  const video = document.getElementById("vid" + videoId);
  const velInput = document.getElementById("vel" + videoId);
  if (video.defaultPlaybackRate > MIN_RATE) {
    video.defaultPlaybackRate = Math.max(video.defaultPlaybackRate - 1, MIN_RATE);
  }
  velInput.value = video.defaultPlaybackRate;
  video.playbackRate = video.defaultPlaybackRate;
  video.play();
}

function loop(videoId) {
  const video = document.getElementById("vid" + videoId);
  const loopLabel = document.getElementById("loop" + videoId);
  video.loop = !video.loop;
  loopLabel.textContent = video.loop ? "desligar loop" : "Loop";
  if (video.loop) video.play();
}

function makeBig(videoId) {
  const video = document.getElementById("vid" + videoId);
  const col = video.parentElement;
  col.className = "col-12 text-center mt-2";
  video.style.maxWidth = "100%";
}

function makeNormal(videoId) {
  const video = document.getElementById("vid" + videoId);
  const col = video.parentElement;
  col.className = "col-12 col-md-4 text-center mt-2";
  video.style.maxWidth = "420px";
}
