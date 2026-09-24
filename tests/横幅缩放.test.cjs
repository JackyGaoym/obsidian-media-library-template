const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const hero = fs.readFileSync(path.join(root, '媒体库/视图/作品头图/view.js'), 'utf8');
const css = fs.readFileSync(path.join(root, '.obsidian/snippets/media-library.css'), 'utf8');
const propertyTypes = JSON.parse(fs.readFileSync(path.join(root, '.obsidian/types.json'), 'utf8')).types;

const start = hero.indexOf('const backdropTravel =');
const end = hero.indexOf('\n};', start);
assert(start >= 0 && end > start, 'missing backdropTravel');
const backdropTravel = vm.runInNewContext(`${hero.slice(start, end + 3)}\nbackdropTravel`);

test('work hero compiles as an async Dataview script', () => {
  assert.doesNotThrow(() => new vm.Script(`(async () => {\n${hero}\n})`));
});

test('portrait banners can shrink to reveal the entire image and pan inside the filled area', () => {
  const cover = backdropTravel(1200, 400, 600, 900, 1);
  assert.equal(cover.x, 0);
  assert.equal(cover.y, -1400);
  assert.ok(cover.containScale < 0.23 && cover.containScale > 0.22);

  const contained = backdropTravel(1200, 400, 600, 900, cover.containScale);
  assert.ok(contained.x > 900);
  assert.ok(Math.abs(contained.y) < 0.001);

  const shifted = backdropTravel(1200, 400, 600, 900, 0.5);
  assert.equal(shifted.x, 600);
  assert.ok(Math.abs(200 / shifted.x * 100 - 100 / 3) < 0.001);
});

test('zooming in retains the original crop direction and existing notes default to 100%', () => {
  const enlarged = backdropTravel(1200, 400, 600, 900, 1.4);
  assert.equal(enlarged.x, -480);
  assert.equal(120 / enlarged.x * 100, -25);
  assert.match(hero, /const parseBackdropScale = value =>/);
  assert.match(hero, /scale >= 0\.05 && scale <= 2 \? scale : 1/);
  assert.match(hero, /delete frontmatter\.backdrop_scale/);
  assert.match(css, /\.media-backdrop-preview-fill/);
  assert.match(css, /\.media-work-backdrop-focus/);
  assert.match(css, /\.media-work-hero:not\(\.is-backdrop-underfilled\) \.media-work-backdrop-layer::before/);
  assert.match(hero, /root\.classList\.toggle\("is-backdrop-underfilled", Boolean\(selectedUrl\) && liveBackdropScale < 1\)/);
  assert.equal(propertyTypes.backdrop_scale, 'number');
});

test('landscape preview scales the entire original image instead of a pre-cropped cover', () => {
  const travel = backdropTravel(1200, 480, 3840, 2160, 1);
  assert.ok(Math.abs(travel.containScale - 32 / 45) < 0.001);
  assert.ok(Math.abs(1 / travel.containScale - 45 / 32) < 0.001);
  const contained = backdropTravel(1200, 480, 3840, 2160, travel.containScale);
  assert.ok(Math.abs(contained.y) < 0.001);
  assert.match(hero, /image\.style\.transform = `scale\(\$\{this\.scale \/ containScale\}\)`/);
  assert.match(hero, /backdropFocus\.style\.transform = `scale\(\$\{liveBackdropScale \/ containScale\}\)`/);
  assert.match(css, /\.media-backdrop-preview-focus \{\s*object-fit: contain !important/);
  assert.match(css, /\.media-work-backdrop-focus \{[\s\S]*?object-fit: contain/);
});

test('banner picker keeps intrinsic card heights and scrolls when there are many images', () => {
  assert.match(css, /\.media-backdrop-picker-grid \{[\s\S]*?overflow-y: auto;[\s\S]*?grid-auto-rows: max-content/);
  assert.match(css, /\.media-backdrop-picker-card \{[\s\S]*?flex-direction: column/);
  assert.match(css, /\.media-backdrop-picker-card span \{[\s\S]*?flex: none/);
});
