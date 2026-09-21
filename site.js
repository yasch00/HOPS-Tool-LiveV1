/* HOPS site behaviour: nav toggle, scroll reveal, TOC, JSON-driven table + feed. ~4KB. */
(function(){
// mobile nav
var t=document.querySelector('.nav-toggle'),l=document.querySelector('nav.links');
if(t&&l)t.addEventListener('click',function(){var o=l.classList.toggle('open');t.setAttribute('aria-expanded',o)});
// scroll reveal for figures
// elements already in view at load are revealed at once (a tall hero on a phone never reaches a 20% threshold otherwise)
var io=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){e.target.classList.add('on');io.unobserve(e.target)}})},{threshold:[0,.1]});
document.querySelectorAll('[data-reveal]').forEach(function(el){var r=el.getBoundingClientRect();if(r.top<window.innerHeight&&r.bottom>0)el.classList.add('on');else io.observe(el)});
setTimeout(function(){document.querySelectorAll('[data-reveal]:not(.on)').forEach(function(el){var r=el.getBoundingClientRect();if(r.top<window.innerHeight&&r.bottom>0)el.classList.add('on')})},1500);
// TOC active state
var links=[].slice.call(document.querySelectorAll('.toc a'));
if(links.length){
var secs=links.map(function(a){return document.querySelector(a.getAttribute('href'))}).filter(Boolean);
var so=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){links.forEach(function(a){a.classList.toggle('active',a.getAttribute('href')==='#'+e.target.id)})}})},{rootMargin:'-20% 0px -70% 0px'});
secs.forEach(function(s){so.observe(s)});
}
// citation cards: keep inside the viewport (cards are display:none until open, so measure on open)
function placeCard(m){var c=m.querySelector('.card');if(!c)return;c.style.transform='translateX(-50%)';
var r=c.getBoundingClientRect(),pad=12,dx=0;
if(r.right>window.innerWidth-pad)dx=window.innerWidth-pad-r.right;
if(r.left+dx<pad)dx=pad-r.left;
c.style.transform='translateX(calc(-50% + '+Math.round(dx)+'px))'}
document.addEventListener('pointerenter',function(e){var m=e.target.closest&&e.target.closest('.cite');if(m)placeCard(m)},true);
document.addEventListener('focusin',function(e){var m=e.target.closest&&e.target.closest('.cite');if(m)placeCard(m)});
// version stamp
document.querySelectorAll('[data-build]').forEach(function(e){e.textContent=e.dataset.build});
})();

/* Generic JSON list renderer used by Data & Watch pages.
   HOPS.list({url, mount, status, count, render, filters, group}) */
window.HOPS=window.HOPS||{};
HOPS.list=function(cfg){
var mount=document.querySelector(cfg.mount),status=document.querySelector(cfg.status),
count=cfg.count?document.querySelector(cfg.count):null,rows=[],state={q:'',chips:{},sel:{}};
function show(el,on){if(el)el.hidden=!on}
function skeleton(n){var h='';for(var i=0;i<n;i++)h+='<div class="skeleton"><div class="sk-line" style="width:38%"></div><div class="sk-line" style="width:72%"></div><div class="sk-line" style="width:24%"></div></div>';return h}
status.innerHTML='<div class="feed" aria-busy="true" aria-label="Loading">'+skeleton(cfg.skeleton||4)+'</div>';
show(status,true);show(mount,false);

function match(r){
if(state.q){var hay=(cfg.searchText?cfg.searchText(r):JSON.stringify(r)).toLowerCase();if(hay.indexOf(state.q)<0)return false}
for(var k in state.chips){var v=state.chips[k];if(v&&v.length&&v.indexOf(String(r[k]))<0)return false}
for(var s in state.sel){var val=state.sel[s];if(val&&val!=='all'&&String(r[s])!==val)return false}
if(cfg.extraFilter&&!cfg.extraFilter(r,state))return false;
return true;
}
function draw(){
var out=rows.filter(match);
if(count)count.textContent=out.length+' / '+rows.length+(cfg.noun?' '+cfg.noun:'');
if(!out.length){status.innerHTML='<div class="empty"><h3>'+(cfg.emptyTitle||'No matches')+'</h3><p>'+(cfg.emptyBody||'Try clearing a filter or widening the date range.')+'</p><button class="btn ghost sm" data-clear>Clear all filters</button></div>';
var b=status.querySelector('[data-clear]');if(b)b.addEventListener('click',function(){state.q='';state.chips={};state.sel={};
document.querySelectorAll(cfg.scope+' .chip').forEach(function(c){c.setAttribute('aria-pressed','false')});
document.querySelectorAll(cfg.scope+' input').forEach(function(i){i.value=''});
document.querySelectorAll(cfg.scope+' select').forEach(function(s){s.value='all'});draw()});
show(status,true);show(mount,false);return}
show(status,false);show(mount,true);
mount.innerHTML=cfg.group?cfg.group(out):out.map(cfg.render).join('');
}
fetch(cfg.url).then(function(r){if(!r.ok)throw 0;return r.json()}).then(function(d){rows=cfg.pick?cfg.pick(d):d;draw()})
.catch(function(){status.innerHTML='<div class="empty"><h3>Data unavailable</h3><p>The feed could not be loaded. It is served as a static JSON file — check the path or try again.</p></div>';show(status,true)});

var scope=document.querySelector(cfg.scope)||document;
scope.addEventListener('input',function(e){
if(e.target.matches('input[type=search],input[type=text]')){state.q=e.target.value.trim().toLowerCase();draw()}
if(e.target.matches('select')){state.sel[e.target.dataset.field]=e.target.value;draw()}
});
scope.addEventListener('click',function(e){
var c=e.target.closest('.chip');if(!c)return;
var f=c.dataset.field,v=c.dataset.value,on=c.getAttribute('aria-pressed')==='true';
c.setAttribute('aria-pressed',!on);
state.chips[f]=state.chips[f]||[];
if(on)state.chips[f]=state.chips[f].filter(function(x){return x!==v});else state.chips[f].push(v);
draw();
});
};
HOPS.esc=function(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})};
