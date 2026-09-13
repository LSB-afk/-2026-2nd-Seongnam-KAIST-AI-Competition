/* Test-only SDK boundary simulation. This is not NAVER cartography or live SDK validation. */
(() => {
  const state = window.__naverMock = { created: 0, destroyed: 0, resized: [], options: [], maps: [], activeEvents: 0, emitAll(event) { this.maps.forEach(map => map.emit(event)); } };
  class LatLng { constructor(lat, lng) { this.latitude = lat; this.longitude = lng; } lat() { return this.latitude; } lng() { return this.longitude; } }
  class Point { constructor(x, y) { this.x = x; this.y = y; } }
  class Size { constructor(width, height) { this.width = width; this.height = height; } }
  class LatLngBounds { constructor() { this.points = []; } extend(point) { this.points.push(point); } }
  function project(point, zoom) { const scale = 256 * 2 ** zoom; const sine = Math.sin(point.lat() * Math.PI / 180); return new Point((point.lng() + 180) / 360 * scale, (0.5 - Math.log((1 + sine) / (1 - sine)) / (4 * Math.PI)) * scale); }
  function unproject(point, zoom) { const scale = 256 * 2 ** zoom; return new LatLng(Math.atan(Math.sinh(Math.PI * (1 - 2 * point.y / scale))) * 180 / Math.PI, point.x / scale * 360 - 180); }
  class Map {
    constructor(container, options) {
      this.container = container; this.options = options; this.center = options.center; this.zoom = options.zoom; this.events = new Set(); this.markers = new Set(); this.dead = false;
      this.background = document.createElement('div'); this.background.textContent = 'SDK 모의 지도'; this.background.setAttribute('data-mock-map', 'true');
      Object.assign(this.background.style, {position:'absolute',inset:'0',background:'#dae6dd',color:'#476153',display:'grid',placeItems:'center'}); container.appendChild(this.background);
      state.created++; state.maps.push(this); state.options.push(options); this.notify();
    }
    emit(name) { if (!this.dead) this.events.forEach(handle => { if (handle.name === name) handle.listener(); }); }
    notify() { setTimeout(() => { if (this.dead) return; this.markers.forEach(marker => marker.draw()); this.emit('idle'); if (window.__naverMockMode !== 'no-tiles') this.emit('tilesloaded'); }, 0); }
    getCenter() { return this.center; } getZoom() { return this.zoom; }
    setCenter(center) { this.center = center; this.notify(); } panTo(center) { this.setCenter(center); }
    setZoom(zoom) { this.zoom = Math.min(18,Math.max(5,zoom)); this.notify(); }
    setSize(size) { state.resized.push(size); this.notify(); }
    fitBounds(bounds) { if (!bounds.points.length) return; this.center = new LatLng(bounds.points.reduce((n,p)=>n+p.lat(),0)/bounds.points.length,bounds.points.reduce((n,p)=>n+p.lng(),0)/bounds.points.length); this.zoom=13; this.notify(); }
    getProjection() { return { fromCoordToOffset: coord => { const p=project(coord,this.zoom),c=project(this.center,this.zoom); return new Point(p.x-c.x+this.container.clientWidth/2,p.y-c.y+this.container.clientHeight/2); }, fromOffsetToCoord: point => { const c=project(this.center,this.zoom);return unproject(new Point(point.x+c.x-this.container.clientWidth/2,point.y+c.y-this.container.clientHeight/2),this.zoom); } }; }
    destroy() { if(this.dead)return;this.dead=true;state.destroyed++;this.background.remove();this.markers.forEach(marker=>marker.setMap(null)); }
  }
  class Marker {
    constructor(options) { this.position=options.position;this.button=options.icon.content;this.anchor=options.icon.anchor;this.setMap(options.map); }
    setPosition(position) { this.position=position;this.draw(); }
    setMap(map) { this.map?.markers.delete(this);this.button.remove();this.map=map;if(map){map.markers.add(this);map.container.appendChild(this.button);this.draw();} }
    draw() { if(!this.map)return;const p=this.map.getProjection().fromCoordToOffset(this.position);Object.assign(this.button.style,{position:'absolute',left:`${p.x-this.anchor.x}px`,top:`${p.y-this.anchor.y}px`}); }
  }
  const Event = { addListener(map,name,listener) { const handle={map,name,listener};map.events.add(handle);state.activeEvents++;return handle; }, removeListener(handle) { if(handle.map.events.delete(handle))state.activeEvents--; } };
  window.naver = { maps: { Map,Marker,LatLng,Point,Size,LatLngBounds,Event } };
  if(window.__naverMockMode==='authentication') window.navermap_authFailure?.();
  else { const callback = document.currentScript?.src ? new URL(document.currentScript.src).searchParams.get('callback') : '__timestoryNaverReady';window[callback]?.(); }
})();
