/* Sample Atlas — visualization code. Data comes from data/bundle.js (window.BUNDLE). */
(function(){
  const B = window.BUNDLE, fmt = d3.format(","), reduce = matchMedia("(prefers-reduced-motion:reduce)").matches;
  // palette: every color is a token in css/style.css
  const css=getComputedStyle(document.documentElement), tok=k=>css.getPropertyValue("--"+k).trim();
  const P={ node:tok("node"), nodeDeep:tok("node-deep"), bar:tok("bar"), tip:tok("tip"),
    spotNode:tok("spot-node"), spotBar:tok("spot-bar"), spotEdge:tok("spot-edge"), edge:tok("edge"),
    created:tok("created"), created2:tok("orange-2"), created3:tok("orange-3"), activity:tok("activity"),
    orangeText:tok("orange-text"), ink3:tok("ink-3"), hair:tok("hair"), surface:tok("surface") };

  // scale stage to viewport
  const stage = document.getElementById("stage");
  function fit(){ const s=Math.min(innerWidth/1080, innerHeight/1920);
    stage.style.transform=`translate(-50%,-50%) scale(${s})`; }
  addEventListener("resize",fit); fit();

  // ── header kpis
  document.getElementById("k-cats").textContent = B.meta.nCategories;
  document.getElementById("k-files").textContent = fmt(B.meta.totalFiles);
  // replay window (calendar days, ET) shown top right
  const M=B.meta, dayDate=s=>new Date(s+"T12:00:00Z");
  const fMD=d3.utcFormat("%b %-d"), fY=d3.utcFormat("%Y");
  const dA=dayDate(M.dateStart), dB=dayDate(M.dateEnd);
  document.getElementById("win-dates").textContent = `${fMD(dA)} – ${fMD(dB)}, ${fY(dB)}`;

  // ── build hierarchy + radial layout
  const W=1080; let H=document.getElementById("atlas").clientHeight||1100;
  // OncoTree depth shown: deeper codes roll up into their ancestor at this level
  // (their samples count there and their events play there). Change to show more or fewer rings.
  const MAX_DEPTH=3;
  const rollup=new Map();
  function prune(d,depth){
    const o=Object.assign({},d); delete o.children;
    if(!d.children||!d.children.length) return o;
    if(depth<MAX_DEPTH){ o.children=d.children.map(c=>prune(c,depth+1)); return o; }
    (function walk(x){ x.children&&x.children.forEach(c=>{ rollup.set(c.code,d.code); o.n_direct=(o.n_direct||0)+(c.n_direct||0); walk(c); }); })(d);
    return o;
  }
  const shown=c=>rollup.get(c)||c;
  B.events.forEach(e=>{ e[0]=shown(e[0]); });
  const root = d3.hierarchy(prune(B.tree,0));
  // ring radii: first ring just outside the hub, last ring at OUT, the rest evenly between
  const OUT=360, R1=162, HUB_R=104, LR=OUT+60;
  const RING=[0].concat(d3.range(MAX_DEPTH).map(i=>MAX_DEPTH===1?OUT:R1+(OUT-R1)*i/(MAX_DEPTH-1)));
  const rOf = d=> d===0?0 : RING[Math.min(d,RING.length-1)];
  const cluster = d3.cluster().size([2*Math.PI,1]).separation((a,b)=>(a.parent===b.parent?1:1.35));
  cluster(root);
  const maxSub = d3.max(root.descendants().filter(d=>d.depth>0), d=>d.data.n_subtree||1);
  const sizeScale = d3.scaleSqrt().domain([1,maxSub]).range([2.4,18]).clamp(true);
  const nodeR = d=> d.depth===0?0 : sizeScale(Math.max(1,d.liveSub||0));
  root.each(n=>{ n.ang=n.x; n.rr=rOf(n.depth);
    n.px=Math.sin(n.ang)*n.rr; n.py=-Math.cos(n.ang)*n.rr; });

  // code -> node ; level1 -> subtree code set + angular extent
  const codeMap=new Map(); root.each(n=>codeMap.set(n.data.code,n));
  // live sample counts: start at the state before the replay window, grow as samples arrive
  const live=new Map();
  function resetCounts(){ live.clear(); Object.entries(B.base||{}).forEach(([k,v])=>{ const c=shown(k); live.set(c,(live.get(c)||0)+v); });
    root.eachAfter(n=>{ n.liveSub=(live.get(n.data.code)||0)+(n.children?d3.sum(n.children,c=>c.liveSub):0); }); }
  resetCounts();
  const subtreeCodes=new Map(), extent=new Map();
  root.children.forEach(c=>{ const s=new Set(); let a0=Infinity,a1=-Infinity;
    c.descendants().forEach(d=>{ s.add(d.data.code); a0=Math.min(a0,d.ang); a1=Math.max(a1,d.ang); });
    subtreeCodes.set(c.data.code,s); extent.set(c.data.code,[a0,a1]); c.la=(a0+a1)/2; });   // c.la: wedge centre, where the label sits

  // ── svg scaffold
  const svg=d3.select("#atlas").append("svg").attr("viewBox",`0 0 ${W} ${H}`);
  const defs=svg.append("defs");
  // soft paper shadow for the hub disc
  defs.append("filter").attr("id","lift").attr("x","-30%").attr("y","-30%").attr("width","160%").attr("height","160%")
    .append("feDropShadow").attr("dx",0).attr("dy",4).attr("stdDeviation",9).attr("flood-color","#3c321e").attr("flood-opacity",.09);

  const g=svg.append("g");
  // concentric rings
  const ringsG=g.append("g");
  ringsG.selectAll("circle").data(RING.slice(1)).enter().append("circle")
    .attr("class","ringline").attr("r",d=>d);
  // faint spokes at level-1 boundaries
  g.append("g").selectAll("line").data(root.children).enter().append("line")
    .attr("class","spoke")
    .attr("x1",d=>Math.sin(d.ang-Math.PI/B.meta.nCategories)*(HUB_R+8))
    .attr("y1",d=>-Math.cos(d.ang-Math.PI/B.meta.nCategories)*(HUB_R+8))
    .attr("x2",d=>Math.sin(d.ang-Math.PI/B.meta.nCategories)*(OUT+42))
    .attr("y2",d=>-Math.cos(d.ang-Math.PI/B.meta.nCategories)*(OUT+42));

  // wedge (spotlight) layer
  const wedge=g.append("path").attr("fill",tok("orange-tint")).attr("stroke",P.created).attr("stroke-opacity",.4).attr("stroke-width",1).attr("opacity",0);
  const arcGen=(a0,a1)=>d3.arc()({innerRadius:HUB_R,outerRadius:OUT+46,startAngle:a0-0.03,endAngle:a1+0.03});

  // links
  function linkPath(d){const s=d.source,t=d.target;
    const x1=Math.sin(s.ang)*s.rr,y1=-Math.cos(s.ang)*s.rr;
    const x2=Math.sin(t.ang)*t.rr,y2=-Math.cos(t.ang)*t.rr;
    const rm=(s.rr+t.rr)/2,cxp=Math.sin(t.ang)*rm,cyp=-Math.cos(t.ang)*rm;
    return `M${x1},${y1}Q${cxp},${cyp} ${x2},${y2}`;}
  const linkSel=g.append("g").selectAll("path").data(root.links()).enter().append("path")
    .attr("class","link").attr("d",linkPath)
    .attr("data-root",d=>d.target.ancestors().find(a=>a.depth===1)?.data.code||"");

  // nodes
  const nodeSel=g.append("g").selectAll("g").data(root.descendants().filter(d=>d.depth>0)).enter()
    .append("g").attr("class","node").attr("transform",d=>`translate(${d.px},${d.py})`)
    .attr("data-root",d=>d.ancestors().find(a=>a.depth===1).data.code);
  nodeSel.append("circle").attr("r",d=>nodeR(d))
    .attr("fill",d=>d.depth===1?P.node:P.nodeDeep)
    .attr("opacity",d=>d.depth===1?1:.85)
    .attr("stroke",d=>d.depth===1?P.surface:null).attr("stroke-width",d=>d.depth===1?1.5:null);

  // outer data band: one radial bar per subtype, length = samples coded to it
  const leaves=root.leaves();
  const barLen=d3.scaleLog().domain([1,d3.max(leaves,d=>d.data.n_direct||1)]).range([3,26]).clamp(true);
  const barL=d=>{const v=live.get(d.data.code)||0; return v<1?0:barLen(v);};
  const barSel=g.append("g").selectAll("line").data(leaves).enter().append("line")
    .attr("data-root",d=>d.ancestors().find(a=>a.depth===1).data.code)
    .attr("x1",d=>Math.sin(d.ang)*(OUT+9)).attr("y1",d=>-Math.cos(d.ang)*(OUT+9))
    .attr("x2",d=>Math.sin(d.ang)*(OUT+9+barL(d))).attr("y2",d=>-Math.cos(d.ang)*(OUT+9+barL(d)))
    .attr("stroke",P.bar).attr("stroke-width",2.2).attr("stroke-linecap","round").attr("opacity",.6);
  const leafByCode=new Map(leaves.map(d=>[d.data.code,d]));
  const tipSel=g.append("g").selectAll("circle").data(leaves).enter().append("circle")
    .attr("data-root",d=>d.ancestors().find(a=>a.depth===1).data.code)
    .attr("cx",d=>Math.sin(d.ang)*(OUT+12+barL(d))).attr("cy",d=>-Math.cos(d.ang)*(OUT+12+barL(d)))
    .attr("r",1.6).attr("fill",P.tip).attr("opacity",.55);

  // category labels: curved along the outer edge (top half reads clockwise, bottom half flipped upright)
  const SHORT={"Peripheral Nervous System":"Periph. Nerve","Bladder/Urinary Tract":"Bladder",
    "Ovary/Fallopian Tube":"Ovary","Esophagus/Stomach":"Esophagus","Ampulla of Vater":"Ampulla","Biliary Tract":"Biliary","Head and Neck":"Head & Neck","Adrenal Gland":"Adrenal"};
  const angDist=(a,b)=>{const d=Math.abs(a-b)%(2*Math.PI);return Math.min(d,2*Math.PI-d)};
  const labelG=g.append("g"), lblInfo=[];
  root.children.forEach(c=>{
    const a=c.la, top=Math.cos(a)>=0, r=top?LR:LR+11, d=0.62;
    const P=x=>[Math.sin(x)*r,-Math.cos(x)*r];
    const [x0,y0]=P(top?a-d:a+d), [x1,y1]=P(top?a+d:a-d);
    defs.append("path").attr("id","lp-"+c.data.code).attr("d",`M${x0},${y0} A${r},${r} 0 0 ${top?1:0} ${x1},${y1}`);
    const tx=labelG.append("text").attr("class","catlabel").attr("data-root",c.data.code).attr("opacity",0);
    tx.append("textPath").attr("href","#lp-"+c.data.code).attr("startOffset","50%").attr("text-anchor","middle")
      .text(SHORT[c.data.name]||c.data.name);
    lblInfo.push({c,el:tx.node()});
  });
  // keep a label only if its arc doesn't collide with a bigger site's label; the spotlit site always wins
  function cullLabels(spot){
    const prev=lblInfo.map(o=>o.el.style.fontSize);
    lblInfo.forEach(o=>o.el.style.fontSize="13.5px");
    const items=lblInfo.map(o=>{let len=80;try{len=o.el.getComputedTextLength()||80}catch(e){}
      const isSpot=o.c.data.code===spot; return {o,isSpot,L:isSpot?len*17/13.5:len};});
    lblInfo.forEach((o,i)=>o.el.style.fontSize=prev[i]);
    items.sort((a,b)=>(b.isSpot-a.isSpot)||(b.o.c.data.n_subtree-a.o.c.data.n_subtree));
    const kept=[];
    items.forEach(it=>{ if(kept.every(k=>angDist(k.o.c.la,it.o.c.la)*LR>=(k.L+it.L)/2+9)) kept.push(it); });
    const ks=new Set(kept.map(k=>k.o.c.data.code));
    lblInfo.forEach(o=>{const v=ks.has(o.c.data.code)?1:0; o.el.setAttribute("data-shown",v);});
  }
  cullLabels(null);
  labelG.selectAll(".catlabel").attr("opacity",function(){return this.getAttribute("data-shown")==="1"?.85:0});

  // hub
  g.append("circle").attr("class","hubc").attr("r",HUB_R).attr("fill",P.surface).attr("filter","url(#lift)");
  g.append("circle").attr("class","hubc").attr("r",HUB_R).attr("fill","none").attr("stroke",P.hair).attr("stroke-width",1);
  g.append("circle").attr("class","hubc").attr("r",HUB_R-9).attr("fill","none").attr("stroke",P.hair).attr("stroke-width",.75).attr("stroke-dasharray","1.5 3.5");
  g.append("text").attr("class","hub-tot").attr("y",-46).text("Total");
  const hubNum=g.append("text").attr("class","hub-num").attr("y",-8).text("0");
  g.append("text").attr("class","hub-lab").attr("y",13).text("Patient samples");
  const hubCat=g.append("text").attr("class","hub-cat").attr("y",44);
  // spotlit site name inside the hub: wraps onto two lines (breaking after spaces or "/"), shrinking if needed
  const probe=g.append("text").attr("class","hub-cat").attr("opacity",0);
  function setHubCat(name){
    const words=name.replace(/\//g,"/ ").split(/\s+/).filter(Boolean), maxW=[150,128];
    const join=ws=>ws.join(" ").replace(/\/ /g,"/");
    let best=null;
    for(let fs=18; fs>=12; fs--){
      probe.style("font-size",fs+"px");
      const w=t=>{probe.text(t); return probe.node().getComputedTextLength();};
      const lines=[[]];
      words.forEach(wd=>{ const cur=lines[lines.length-1], lim=maxW[Math.min(lines.length-1,1)];
        if(cur.length && w(join(cur.concat(wd)))>lim) lines.push([wd]); else cur.push(wd); });
      best={fs,lines:lines.map(join)};
      if(lines.length<=2 && best.lines.every((l,i)=>w(l)<=maxW[i])) break;
    }
    hubCat.selectAll("tspan").remove(); hubCat.style("font-size",best.fs+"px");
    best.lines.forEach((l,i)=>hubCat.append("tspan").attr("x",0).attr("dy",i?best.fs*1.15:0).text(l));
  }

  const pulseL=g.append("g"); // pulses on top

  // fit the whole atlas (labels at their largest spotlight size) into the space left by the panels
  function fitAtlas(){
    H=document.getElementById("atlas").clientHeight||H;
    svg.attr("viewBox",`0 0 ${W} ${H}`);
    const lbls=labelG.selectAll(".catlabel").nodes(), prev=lbls.map(n=>n.style.fontSize);
    lbls.forEach(n=>n.style.fontSize="17px");
    const bb=g.node().getBBox();
    lbls.forEach((n,i)=>n.style.fontSize=prev[i]);
    const halfW=Math.max(-bb.x,bb.x+bb.width), halfH=Math.max(-bb.y,bb.y+bb.height), m=40;
    const s=Math.min((W/2-m)/halfW,(H/2-m)/halfH,1);   // never enlarge past design size: keeps air around the circle
    g.attr("transform",`translate(${W/2},${H/2}) scale(${s.toFixed(4)})`);
  }
  fitAtlas();
  if(document.fonts&&document.fonts.ready) document.fonts.ready.then(()=>{ cullLabels(curSpot); fitAtlas();
    labelG.selectAll(".catlabel").attr("opacity",function(){return this.getAttribute("data-root")===curSpot?1:(this.getAttribute("data-shown")==="1"?.8:0)}); });

  // ── live counters
  let total=B.meta.baseSamples??B.meta.totalSamples, evStreamed=0, gen=0;
  const kS=document.getElementById("k-samples"), kE=document.getElementById("k-ev");
  function setTotal(v){ hubNum.text(fmt(v)); kS.textContent=fmt(v); }
  setTotal(total);
  // animate kpis in
  d3.select(kS).transition().duration(1400).tween("t",function(){const i=d3.interpolateNumber(0,total);return t=>kS.textContent=fmt(Math.round(i(t)))});
  d3.select("#k-files").transition().duration(1400).tween("t",function(){const i=d3.interpolateNumber(0,B.meta.totalFiles);return t=>document.getElementById("k-files").textContent=fmt(Math.round(i(t)))});

  // ── animation layers
  const sparkL=g.append("g");      // new-sample sparks travel above everything
  const PT=(n,r)=>[Math.sin(n.ang)*r,-Math.cos(n.ang)*r];

  // flicker the outer bar of a specific diagnosis
  function flickerBar(code,role){
    const d=leafByCode.get(code); if(!d) return;
    const L=barL(d), [x1,y1]=PT(d,OUT+9), [x2,y2]=PT(d,OUT+9+L+6);
    pulseL.append("line").attr("x1",x1).attr("y1",y1).attr("x2",x2).attr("y2",y2)
      .attr("stroke",role?P.created:P.activity).attr("stroke-width",role?4:3).attr("stroke-linecap","round")
      .attr("opacity",role?1:.85)
      .transition().duration(role?1300:950).ease(d3.easeCubicIn).attr("opacity",0).remove();
  }

  // green ripple: a file moved through the pipeline
  function fileRipple(node){
    pulseL.append("circle").attr("cx",node.px).attr("cy",node.py).attr("r",nodeR(node)+1.5)
      .attr("fill","none").attr("stroke",P.activity).attr("stroke-width",1.4).attr("opacity",.65)
      .transition().duration(950).ease(d3.easeCubicOut)
      .attr("r",nodeR(node)+15).attr("opacity",0).attr("stroke-width",.4).remove();
  }

  // orange spark: a new sample leaves the center and joins its cancer type
  const SPARK_MS=reduce?0:1500;
  const circleBy=new Map(), barBy=new Map(), tipBy=new Map();
  nodeSel.each(function(d){ circleBy.set(d.data.code,d3.select(this).select("circle")); });
  barSel.each(function(d){ barBy.set(d.data.code,d3.select(this)); });
  tipSel.each(function(d){ tipBy.set(d.data.code,d3.select(this)); });
  function drawBar(d,dur){
    const L=barL(d);
    (barBy.get(d.data.code)).transition().duration(dur).attr("x2",Math.sin(d.ang)*(OUT+9+L)).attr("y2",-Math.cos(d.ang)*(OUT+9+L));
    (tipBy.get(d.data.code)).transition().duration(dur).attr("cx",Math.sin(d.ang)*(OUT+12+L)).attr("cy",-Math.cos(d.ang)*(OUT+12+L));
  }
  function grow(code){
    const n=codeMap.get(code); if(!n) return;
    live.set(code,(live.get(code)||0)+1);
    n.ancestors().forEach(a=>{ a.liveSub=(a.liveSub||0)+1;
      const c=circleBy.get(a.data.code); if(c) c.transition().duration(600).ease(d3.easeBackOut).attr("r",nodeR(a)); });
    if(barBy.has(code)) drawBar(n,600);
  }
  let zoomsThisLoop=0;   // the first zoom of every loop also explains how to read the atlas
  function restartLoop(){
    zoomsThisLoop=0;
    gen++; resetCounts(); total=B.meta.baseSamples??total; setTotal(total);
    evStreamed=0; kE.textContent="0"; tick.innerHTML=""; setClock(0);   // a new loop starts from zero: events counter, log and timeline too
    nodeSel.select("circle").transition().duration(1500).attr("r",d=>nodeR(d));
    leaves.forEach(d=>drawBar(d,1500));
    growthReset();
  }
  // a new sample lands on its cancer type (k = how far the view is zoomed in, so the effects keep their on-screen size)
  function landFx(node,code,k=1){
    pulseL.append("circle").attr("cx",node.px).attr("cy",node.py).attr("r",nodeR(node)+2)
      .attr("fill",P.created).attr("opacity",.28).transition().duration(700).attr("opacity",0).attr("r",nodeR(node)).remove();
    pulseL.append("circle").attr("cx",node.px).attr("cy",node.py).attr("r",nodeR(node)+2)
      .attr("fill","none").attr("stroke",P.created).attr("stroke-width",2.2/k).attr("opacity",.9)
      .transition().duration(1300).ease(d3.easeCubicOut)
      .attr("r",nodeR(node)+38/k).attr("opacity",0).attr("stroke-width",.4/k).remove();
    flickerBar(code,1); grow(code);
  }
  function arrive(node,code,g0){
    if(g0!==gen) return;
    landFx(node,code);
    total++; setTotal(total); d3.select(kS).interrupt();
  }
  function spark(node,code){
    const g0=gen; if(!SPARK_MS){ arrive(node,code,g0); return; }
    // comet = head + 4 fading followers on the same path, each slightly behind
    const trail=[{r:4.6,o:1,lag:0,f:P.created},{r:3.6,o:.7,lag:55,f:P.created2},{r:2.9,o:.5,lag:110,f:P.created2},{r:2.2,o:.4,lag:170,f:P.created3},{r:1.6,o:.3,lag:240,f:P.created3}];
    trail.forEach((p,i)=>{
      const c=sparkL.append("circle").attr("r",p.r).attr("fill",p.f).attr("opacity",0).attr("cx",0).attr("cy",0);
      if(i===0) c.attr("stroke",P.surface).attr("stroke-width",1.2);
      c.transition().delay(p.lag).duration(0).attr("opacity",p.o)
       .transition().duration(SPARK_MS).ease(d3.easeCubicInOut).attr("cx",node.px).attr("cy",node.py)
       .on("end",function(){ if(i===0) arrive(node,code,g0); })
       .transition().duration(160).attr("opacity",0).remove();
    });
  }

  // ── latest events list (fills the card; only whole rows are kept)
  const tick=document.getElementById("ticker");
  function pushTicker(e){
    const row=document.createElement("div"); row.className="tk";
    const role=e[1], col=role?P.created:P.activity;
    row.innerHTML=`<span class="ic" style="background:${col}"></span>`+
      `<span class="cd">${role?'<span class="new">NEW SAMPLE</span>':"File update"} · ${e[0]}</span>`+
      `<span class="vn">${B.vendors[e[2]]}</span>`;
    tick.prepend(row);
    while(tick.children.length>4) tick.lastElementChild.remove();
  }

  // ── pipeline clock
  const t0=Date.parse(B.meta.tStart), t1=Date.parse(B.meta.tEnd);
  const fDay=new Intl.DateTimeFormat("en-US",{timeZone:"America/New_York",weekday:"short",month:"short",day:"numeric",year:"numeric"});
  const fTime=new Intl.DateTimeFormat("en-US",{timeZone:"America/New_York",hour:"2-digit",minute:"2-digit",hour12:false});
  const clockEl=document.getElementById("clock-date");
  // 7-day timeline: one segment per calendar day (ET), sized by its share of the window
  const tl=document.getElementById("timeline"), fDL=d3.utcFormat("%a %-d"), days=M.days||[[M.dateStart,0,1]];
  tl.style.gridTemplateColumns=`repeat(${days.length},minmax(0,1fr))`;
  const dayLen=86400000/(t1-t0);   // one full day as a fraction of the window; the last day fills only up to "now"
  const segs=days.map(d=>{ const el=document.createElement("div"); el.className="seg";
    el.innerHTML=`<div class="tr"><i></i></div><div class="dl">${fDL(dayDate(d[0]))}</div>`; tl.appendChild(el);
    return {a:d[1],b:d[2],el,fill:el.querySelector("i")}; });
  let lastClock="";
  function setClock(tn){ const d=new Date(t0+tn*(t1-t0)), txt=`${fDay.format(d)} · ${fTime.format(d)} ET`;
    if(txt!==lastClock){ clockEl.textContent=txt; lastClock=txt; }
    segs.forEach(s=>{ const f=Math.max(0,Math.min(1,(tn-s.a)/dayLen));
      s.fill.style.width=(f*100).toFixed(2)+"%"; s.el.classList.toggle("on",tn>=s.a&&tn<s.b||(tn>=1&&s.b>=1)); }); }

  // ── weekly growth line: fills from the first day's total to today's total as samples arrive
  const gBase=B.meta.baseSamples??B.meta.totalSamples, gEnd=B.meta.totalSamples, fShort=d3.utcFormat("%b %-d");
  document.getElementById("gr-start").textContent=fmt(gBase);
  document.getElementById("gr-end").textContent=fmt(gEnd);
  document.getElementById("gr-start-l").textContent=fShort(dayDate(M.dateStart));
  document.getElementById("gr-end-l").textContent=fShort(dayDate(M.dateEnd));
  const grDelta=document.getElementById("gr-delta"), grFill=document.getElementById("gr-fill");
  let gLast=-1;
  function growthTick(){
    if(total===gLast) return; gLast=total;
    grFill.style.width=(100*Math.max(0,Math.min(1,(total-gBase)/((gEnd-gBase)||1)))).toFixed(2)+"%";
    grDelta.textContent="+"+fmt(total-gBase)+" new";
  }
  function growthReset(){ gLast=-1; growthTick(); }

  // ── event engine: real timing — the window's real gaps, compressed into a short loop
  const N=B.events.length, LOOP_MS=(B.meta.loopMin||5)*60*1000;
  let ei=0, vt=0, lastTs=null, holdUntil=0;
  function fire(){
    const e=B.events[ei]; ei++;
    const n=codeMap.get(e[0]);
    if(n){ if(e[1]) spark(n,e[0]); else { fileRipple(n); flickerBar(e[0],0); } pushTicker(e); }
    evStreamed++; kE.textContent=fmt(evStreamed);
    if(ei===N) holdUntil=(lastTs??performance.now())+SPARK_MS+2500;   // let the last sparks land, show today's total, then the recap scene, then start over
  }
  let paused=false;   // true while a body site is zoomed in (or the recap plays): the main loop holds still and picks up afterwards
  let busy=false;     // a zoom or the recap is playing: another one must not start
  function frame(ts){
    if(lastTs===null) lastTs=ts;
    const dt=Math.min(ts-lastTs,250); lastTs=ts;
    if(paused){ requestAnimationFrame(frame); return; }
    if(!holdUntil && ei>=N){ ei=0; vt=0; restartLoop(); }   // the end-of-loop scene was interrupted: just start over
    if(holdUntil){ if(ts<holdUntil){ growthTick(); requestAnimationFrame(frame); return; }
      holdUntil=0;
      if(!reduce && !busy && typeof runRecap==="function" && recapRows.length>1){   // end of the loop: the top-5 recap, then start over
        paused=true;
        runRecap().catch(err=>{ console.error(err); return true; }).then(done=>{ if(!done) return; ei=0; vt=0; restartLoop(); paused=false; });
        requestAnimationFrame(frame); return; }
      ei=0; vt=0; restartLoop(); }
    vt=Math.min(1,vt+dt/LOOP_MS); setClock(vt);
    let k=0; while(k<24 && ei<N && B.events[ei][3]<=vt){ fire(); k++; }
    growthTick();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  setClock(0);

  if(reduce) document.querySelectorAll(".lg svg").forEach(s=>s.pauseAnimations&&s.pauseAnimations());

  // ── spotlight
  const catByName=new Map(B.categories.map(c=>[c.root,c]));
  const level1=root.children.slice().sort((a,b)=>a.ang-b.ang);   // clockwise from 12 o'clock, following the circle
  let si=0, curSpot=null;
  const vbars=document.getElementById("vbars");
  function spotlight(){
    const c=level1[si++ % level1.length], code=c.data.code, set=subtreeCodes.get(code);
    curSpot=code; cullLabels(code);
    // dim/highlight
    nodeSel.attr("opacity",d=>set.has(d.ancestors().find(a=>a.depth===1).data.code)?1:.78);
    const isOn=function(){return this.getAttribute("data-root")===code};
    barSel.attr("stroke",function(){return isOn.call(this)?P.spotBar:P.bar}).attr("opacity",function(){return isOn.call(this)?.95:.45});
    tipSel.attr("fill",function(){return isOn.call(this)?P.spotBar:P.tip}).attr("opacity",function(){return isOn.call(this)?1:.4});
    nodeSel.select("circle").attr("fill",d=>{
      const inSet=set.has(d.ancestors().find(a=>a.depth===1).data.code);
      if(!inSet) return d.depth===1?P.node:P.nodeDeep;
      return P.spotNode;});
    linkSel.attr("opacity",function(){return this.getAttribute("data-root")===code?.95:.32})
      .style("stroke",function(){return this.getAttribute("data-root")===code?P.spotEdge:P.edge});
    labelG.selectAll(".catlabel").style("fill",function(){return this.getAttribute("data-root")===code?P.orangeText:P.ink3})
      .attr("opacity",function(){return this.getAttribute("data-root")===code?1:(this.getAttribute("data-shown")==="1"?.8:0)})
      .style("font-size",function(){return this.getAttribute("data-root")===code?"17px":"13.5px"});
    const ex=extent.get(code); wedge.attr("d",arcGen(ex[0],ex[1])).attr("opacity",1);
    setHubCat(c.data.name); hubCat.attr("opacity",0).transition().duration(400).attr("opacity",1);
    // panel
    const cd=catByName.get(c.data.name);
    const sn=document.getElementById("spot-name"); sn.textContent=c.data.name; let fs=36; sn.style.fontSize=fs+"px";
    while(sn.scrollWidth>sn.clientWidth && fs>24){ fs-=2; sn.style.fontSize=fs+"px"; }
    document.getElementById("spot-samples").textContent=fmt(c.liveSub);
    document.getElementById("spot-share").textContent=(100*c.liveSub/total).toFixed(1)+"%";
    document.getElementById("spot-files").textContent=fmt(cd.n_files);
    const maxv=d3.max(B.vendors,v=>cd.vendors[v]||0)||1;
    vbars.innerHTML="";
    B.vendors.forEach((v,i)=>{const n=cd.vendors[v]||0;
      const row=document.createElement("div");row.className="vbar";
      row.innerHTML=`<span class="nm">${v}</span><div class="track"><div class="fill" style="width:0"></div></div><span class="pc">${fmt(n)}</span>`;
      vbars.appendChild(row);
      requestAnimationFrame(()=>row.querySelector(".fill").style.width=(100*n/maxv)+"%");});
    const subs=c.descendants().filter(d=>d.depth>1).sort((a,b)=>(live.get(b.data.code)||0)-(live.get(a.data.code)||0)).slice(0,3);
    document.getElementById("subs").innerHTML=subs.map(s=>`<div class="sb"><span class="c">${s.data.code}</span><span class="n">${s.data.name}</span><span class="k">${fmt(live.get(s.data.code)||0)}</span></div>`).join("");
  }

  // ── site zoom: the most active body sites get a close-up replay of their week
  // The top ZOOM_TOP sites by events in the window are zoomed when the spotlight reaches them.
  // The main loop pauses, the rest of the atlas fades, and that site's week replays with one even beat
  // per event; then the view eases back and the main loop resumes exactly where it stopped.
  const ZOOM_TOP=5, ZOOM_IN_MS=1700, ZOOM_REPLAY_MS=15000, ZOOM_HOLD_MS=3200, ZOOM_OUT_MS=1400;
  const ZOOM_TOP_PAD=215, ZOOM_BOT_PAD=120;   // room for the headline above and the subtype cards below the zoomed wedge
  const rootOf=code=>{ const n=codeMap.get(code), a=n&&n.ancestors().find(x=>x.depth===1); return a?a.data.code:null; };
  const siteEvents=new Map(root.children.map(c=>[c.data.code,[]]));
  B.events.forEach(e=>{ const r=rootOf(e[0]); if(r) siteEvents.get(r).push(e); });
  const newIn=evs=>evs.reduce((n,e)=>n+e[1],0);
  const zoomRank=new Map(level1.slice()
    .filter(c=>siteEvents.get(c.data.code).length>0)
    .sort((a,b)=>{ const ea=siteEvents.get(a.data.code), eb=siteEvents.get(b.data.code);
      return (eb.length-ea.length)||(newIn(eb)-newIn(ea))||(b.data.n_subtree-a.data.n_subtree); })
    .slice(0,ZOOM_TOP).map((c,i)=>[c.data.code,i+1]));
  // the subtypes (below the body site itself) that grew most this week
  function topSubtypes(code){
    const m=new Map();
    siteEvents.get(code).forEach(e=>{ const n=codeMap.get(e[0]); if(!n||n.depth<2) return;
      const o=m.get(e[0])||{code:e[0],name:n.data.name,nNew:0,ev:0}; o.ev++; o.nNew+=e[1]; m.set(e[0],o); });
    return [...m.values()].sort((a,b)=>(b.nNew-a.nNew)||(b.ev-a.ev)).slice(0,3);
  }

  const zui=document.getElementById("zoomui"), zsubs=document.getElementById("zsubs");
  const zEl=id=>document.getElementById(id), wait=ms=>new Promise(r=>setTimeout(r,ms));
  const plural=(n,one,many)=>n===1?one:many;
  document.getElementById("z-days").textContent=days.length;

  // the transform that fits a site's wedge into the space between the headline and the subtype cards
  function zoomTransform(c,gapUp){
    const [a0,a1]=extent.get(c.data.code), pts=[];
    for(let i=0;i<=10;i++){ const a=a0-.03+(a1-a0+.06)*i/10;
      [HUB_R,OUT+52].forEach(r=>pts.push([Math.sin(a)*r,-Math.cos(a)*r])); }
    const xs=pts.map(p=>p[0]), ys=pts.map(p=>p[1]), pad=24;
    const x0=d3.min(xs)-pad, x1=d3.max(xs)+pad, y0=d3.min(ys)-pad, y1=d3.max(ys)+pad;
    const availTop=ZOOM_TOP_PAD-gapUp, availH=H-ZOOM_BOT_PAD-availTop, s=Math.min((W-90)/(x1-x0), availH/(y1-y0), 3.2);
    return {s, tx:W/2-s*(x0+x1)/2, ty:availTop+availH/2-s*(y0+y1)/2};
  }

  // a compact comet from the inner end of the wedge to the sample's cancer type
  function zoomSpark(node,code,from,k,onLand){
    const trail=[{r:4.6,o:1,lag:0,f:P.created},{r:3.6,o:.6,lag:55,f:P.created2},{r:2.8,o:.4,lag:110,f:P.created3}];
    trail.forEach((p,i)=>{
      const c=sparkL.append("circle").attr("r",p.r/Math.sqrt(k)).attr("fill",p.f).attr("opacity",0).attr("cx",from[0]).attr("cy",from[1]);
      if(i===0) c.attr("stroke",P.surface).attr("stroke-width",1.2/k);
      c.transition().delay(p.lag).duration(0).attr("opacity",p.o)
       .transition().duration(700).ease(d3.easeCubicInOut).attr("cx",node.px).attr("cy",node.py)
       .on("end",function(){ if(i===0){ landFx(node,code,k); onLand(); } })
       .transition().duration(140).attr("opacity",0).remove();
    });
  }

  // Scenes (zoom, recap) can be interrupted by the debug buttons. Every scene waits through sceneWait(), which
  // throws once the scene has been cancelled; cancelScene() then puts the page back at once.
  let sceneId=0, sceneReset=null;
  const CANCELLED={};
  const sceneWait=my=>ms=>new Promise((res,rej)=>setTimeout(()=>my===sceneId?res():rej(CANCELLED),ms));
  function hardReset(home,snap){
    g.interrupt();
    if(snap&&snap.live){   // a zoom replay was running: drop its sparks, put every circle back where the loop had it
      sparkL.selectAll("*").interrupt().remove(); pulseL.selectAll("*").interrupt().remove();
      nodeSel.select("circle").interrupt(); barSel.interrupt(); tipSel.interrupt();
      live.clear(); snap.live.forEach((v,key)=>live.set(key,v)); root.each(n=>{ n.liveSub=snap.sub.get(n); });
      nodeSel.select("circle").attr("r",d=>nodeR(d)); leaves.forEach(d=>drawBar(d,0));
    }
    if(home) g.attr("transform",home);
    const back=g.selectAll(".zout"); back.classed("zback",true).classed("zout",false);
    setTimeout(()=>back.classed("zback",false),700);
    stage.classList.remove("zoomed","recapping");
    zui.classList.remove("on","final"); zsubs.classList.remove("on");
    rc.className=""; rcNote.style.opacity=0; rcPath.style.opacity=0; annReset();
    setClock(vt); paused=false; busy=false;
  }
  function cancelScene(){ sceneId++; if(sceneReset){ const f=sceneReset; sceneReset=null; f(); } }

  // ring arcs across the zoomed wedge, so the OncoTree levels stay readable
  const zann=document.getElementById("zann"), zn=[document.getElementById("za-n1"),document.getElementById("za-n2")],
        zp=[document.getElementById("za-p1"),document.getElementById("za-p2")], zh=[document.getElementById("za-h1"),document.getElementById("za-h2")];
  let zringG=null;
  function buildZoomRings(code,zs){
    const [e0,e1]=extent.get(code), a0=e0-.03, a1=e1+.03;
    const grp=d3.select(ringsG.node().parentNode).insert("g",()=>ringsG.node().nextSibling).attr("class","zr").attr("opacity",0);
    const paths=RING.slice(1).map(r=>{ const p=a=>`${(Math.sin(a)*r).toFixed(1)},${(-Math.cos(a)*r).toFixed(1)}`;
      return grp.append("path").attr("class","zr-base").attr("stroke-width",1.4/zs)
        .attr("d",`M${p(a0)}A${r},${r} 0 ${a1-a0>Math.PI?1:0} 1 ${p(a1)}`).node(); });
    grp.transition().duration(700).attr("opacity",1);
    return {grp,a0,a1,paths};
  }
  function annReset(){
    zn.forEach(n=>n.classList.remove("on")); zp.concat(zh).forEach(p=>{ p.style.transition="none"; p.style.opacity=0; });
    g.selectAll(".zr").interrupt().remove(); zringG=null;
  }
  function annOut(){   // zoom closing: notes and arrows fade with the rest of the text, the ring arcs fade as the full rings return
    zn.forEach(n=>n.classList.remove("on")); zp.concat(zh).forEach(p=>{ p.style.transition="opacity .45s ease"; p.style.opacity=0; });
    if(zringG){ const gr=zringG.grp; gr.transition().duration(600).attr("opacity",0).remove(); zringG=null; }
  }
  // the guided notes of the first zoom: rings light up one by one, then an arrow from each note points at what it explains
  async function zoomIntro(Z,rings,w,code){
    const toScr=(r,f)=>{ const a=rings.a0+(rings.a1-rings.a0)*f; return [Z.tx+Z.s*Math.sin(a)*r, Z.ty-Z.s*Math.cos(a)*r]; };
    const edge=[]; for(let i=0;i<=24;i++){ const a=rings.a0+(rings.a1-rings.a0)*i/24;
      [HUB_R,OUT+46].forEach(r=>edge.push(toScr(r,i/24))); }
    for(let i=0;i<=20;i++){ const r=HUB_R+(OUT+46-HUB_R)*i/20; edge.push(toScr(r,0),toScr(r,1)); }
    const gapUp=8-parseFloat(zui.style.top||8), top=ZOOM_TOP_PAD-gapUp+10, bot=H-ZOOM_BOT_PAD, taken=[];
    const rectDist=(r,p)=>Math.hypot(Math.max(r.x-p[0],0,p[0]-(r.x+r.w)),Math.max(r.y-p[1],0,p[1]-(r.y+r.h)));
    const overlap=(a,b)=>a.x<b.x+b.w+16&&b.x<a.x+a.w+16&&a.y<b.y+b.h+16&&b.y<a.y+a.h+16;
    // soft yellow glow along one level: a few stacked strokes of falling opacity, drawn on from the wedge's first side
    const glow=i=>{ const base=rings.paths[i], len=base.getTotalLength?base.getTotalLength():600, d=base.getAttribute("d");
      const grp=rings.grp.append("g").attr("class","zglow");
      [[18,.10],[10,.20],[3.4,.70]].forEach(([wd,op])=>grp.append("path").attr("class","zhl").attr("d",d).attr("stroke-width",wd/Z.s).attr("opacity",op)
        .attr("stroke-dasharray",len).attr("stroke-dashoffset",len).transition().duration(1000).ease(d3.easeCubicOut).attr("stroke-dashoffset",0));
      return grp; };
    // one step: the level glows, an arrow runs from it to the note, then the note's text appears; the arrow and text stay
    const step=async(k,text,ringIdx)=>{
      // the arrow leaves the level where no circle sits: the point of the level farthest from the circles on it
      const onRing=root.descendants().filter(d=>d.depth===ringIdx+1&&d.ancestors().find(a=>a.depth===1).data.code===code), r=RING[ringIdx+1];
      let f=.14, fd=-1;
      for(let i=10;i<=90;i+=2){ const a=rings.a0+(rings.a1-rings.a0)*i/100, x=Math.sin(a)*r, y=-Math.cos(a)*r;
        const dm=d3.min(onRing,d=>Math.hypot(d.px-x,d.py-y))||0; if(dm>fd){fd=dm;f=i/100;} }
      const T=toScr(r,f), n=zn[k], p=zp[k], hd=zh[k];
      n.textContent=text; const nw=n.offsetWidth, nh=n.offsetHeight;
      // the note sits centred on where the arrow lands, in the free band above or below the wedge
      const left=Math.max(46,Math.min(W-46-nw,T[0]-nw/2));
      // the note sits close to the arrow's end, in free space beside the wedge (never over it)
      const inWedge=q=>{ const gx=(q[0]-Z.tx)/Z.s, gy=(q[1]-Z.ty)/Z.s, rr=Math.hypot(gx,gy); if(rr<HUB_R-10||rr>OUT+56) return false;
        let an=Math.atan2(gx,-gy); if(an<0) an+=2*Math.PI; const lo=((rings.a0%(2*Math.PI))+2*Math.PI)%(2*Math.PI), hi=lo+(rings.a1-rings.a0);
        return (an>=lo&&an<=hi)||(an+2*Math.PI>=lo&&an+2*Math.PI<=hi); };
      const free=r=>{ if(r.y<top||r.y+r.h>bot||taken.some(t=>overlap(t,r))) return false;
        for(let i=0;i<=6;i++) for(let j=0;j<=3;j++) if(inWedge([r.x+r.w*i/6,r.y+r.h*j/3])) return false;
        return d3.min(edge,q=>rectDist(r,q))>=14; };
      let best=null;
      for(const gap of [60,84,112,150,200,280]){ for(const dir of [1,-1]){
        const r={x:left,y:dir<0?T[1]-gap-nh:T[1]+gap,w:nw,h:nh}; if(!best&&free(r)) best=r; } if(best) break; }
      if(!best) best={x:left,y:T[1]>(top+bot)/2?top:bot-nh,w:nw,h:nh};
      taken.push(best); n.style.left=best.x+"px"; n.style.top=best.y+"px";
      const sx=Math.max(best.x+16,Math.min(best.x+nw-16,T[0]));
      // the path starts on the level and ends at the note, so the arrowhead points at the text
      const S=T[1]>best.y+nh?[sx,best.y+nh+12]:[sx,best.y-12], m=(S[1]+T[1])/2;
      const d=`M${T[0]},${T[1]} C${T[0]},${m} ${S[0]},${m} ${S[0]},${S[1]}`;
      const gl=glow(ringIdx);
      await w(900);
      p.setAttribute("d",d); const len=p.getTotalLength?p.getTotalLength():300;
      // arrowhead: its own little mark at the end of the line, oriented along the line, appearing as the line arrives
      let ang=S[1]>T[1]?90:-90;
      if(p.getPointAtLength){ const e=p.getPointAtLength(len), q=p.getPointAtLength(Math.max(0,len-6)); ang=Math.atan2(e.y-q.y,e.x-q.x)*180/Math.PI; }
      hd.setAttribute("transform",`translate(${S[0]},${S[1]}) rotate(${ang})`);
      hd.style.transition="none"; hd.style.opacity=0;
      p.style.transition="none"; p.style.opacity=1; p.style.strokeDasharray=len; p.style.strokeDashoffset=len; void p.getBoundingClientRect();
      p.style.transition="stroke-dashoffset .9s cubic-bezier(.4,0,.2,1)"; p.style.strokeDashoffset=0;
      hd.style.transition="opacity .12s ease .78s"; hd.style.opacity=1;
      await w(950); n.classList.add("on");
      await w(3200);                                   // read it, then the glow fades and the next level takes over
      gl.transition().duration(900).attr("opacity",0).remove();
      await w(600);
    };
    await step(0,"Each ring is a different OncoTree level",0);
    await step(1,"The further out, the more specific the diagnoses",2);
  }

  async function zoomSite(c,opts){
    const code=c.data.code, evs=siteEvents.get(code), rank=zoomRank.get(code), subs=topSubtypes(code);
    const fadeSel=g.selectAll(".ringline,.spoke,.hubc,.hub-tot,.hub-num,.hub-lab,.hub-cat,.catlabel,.link,.node");
    // hold the main loop right away; sparks already in flight finish landing while the view starts to zoom
    paused=true; busy=true;
    const my=++sceneId, w=sceneWait(my);
    const dbg=!!(opts&&opts.debug), intro=dbg||zoomsThisLoop===0; if(!dbg) zoomsThisLoop++;
    const snap={live:null, sub:new Map()};
    const home=g.attr("transform"), s0=+(/scale\(([\d.]+)\)/.exec(home)||[0,1])[1];
    sceneReset=()=>hardReset(home,snap);
    let completed=false;
    // the rows that fade out (KPIs, events log, weekly counter) leave a band under the title: the zoom uses it
    const atlasEl=document.getElementById("atlas"), titleRow=document.querySelector(".titlerow");
    const gapUp=Math.max(0,atlasEl.offsetTop-(titleRow.offsetTop+titleRow.offsetHeight)-72);
    zui.style.top=(8-gapUp)+"px";
    const Z=zoomTransform(c,gapUp), k=Z.s/s0;
    const apex=[Math.sin(c.la)*HUB_R,-Math.cos(c.la)*HUB_R];
    try{
      // zoom in: everything outside the site fades; the site rewinds to its state before the week
      fadeSel.filter(function(){ return this.getAttribute("data-root")!==code; }).classed("zout",true);
      linkSel.filter(d=>d.source.depth===0).classed("zout",true);
      barSel.filter(function(){ return this.getAttribute("data-root")!==code; }).classed("zout",true);
      tipSel.filter(function(){ return this.getAttribute("data-root")!==code; }).classed("zout",true);
      g.selectAll(".ringline,.spoke,.hubc,.hub-tot,.hub-num,.hub-lab,.hub-cat,.catlabel").classed("zout",true);
      sparkL.classed("zout",true); pulseL.classed("zout",true);   // sparks/pulses of the paused loop must not show during the zoom-in
      stage.classList.add("zoomed");   // the events log and sample counter fade too: they are paused behind the zoom
      zringG=buildZoomRings(code,Z.s);
      g.transition().duration(ZOOM_IN_MS).ease(d3.easeCubicInOut).attr("transform",`translate(${Z.tx},${Z.ty}) scale(${Z.s})`);
      // headline + subtype cards
      zEl("z-eyebrow").textContent=`#${rank} most active body site of the week`;
      zEl("z-site").textContent=c.data.name;
      const setHead=(nNew,nEv)=>{ zEl("z-new").textContent=fmt(nNew); zEl("z-ev").textContent=fmt(nEv); };
      setHead(0,0);
      const sub=new Map(subs.map(o=>[o.code,Object.assign({},o,{nNew:0,ev:0,el:null})]));
      zsubs.innerHTML=subs.map(o=>`<div class="zs" data-c="${o.code}"><div class="c">${o.code}</div><div class="n">${o.name}</div>`+
        `<div class="k"><b class="a">+0</b> new · <b class="b">0</b> events</div></div>`).join("");
      zsubs.querySelectorAll(".zs").forEach(el=>sub.get(el.dataset.c).el=el);
      const paintSub=o=>{ if(!o) return; o.el.querySelector(".a").textContent="+"+fmt(o.nNew); o.el.querySelector(".b").textContent=fmt(o.ev); };
      zui.classList.remove("final"); zui.classList.add("on"); if(subs.length) zsubs.classList.add("on");
      // once the last in-flight spark has landed, remember where every circle stood, then rewind the site to the start of the week
      await w(SPARK_MS+350);
      sparkL.selectAll("*").interrupt().remove(); pulseL.selectAll("*").interrupt().remove();
      sparkL.classed("zout",false); pulseL.classed("zout",false);
      snap.live=new Map(live); root.each(n=>snap.sub.set(n,n.liveSub));
      resetCounts();
      nodeSel.select("circle").transition().duration(500).attr("r",d=>nodeR(d));
      leaves.forEach(d=>drawBar(d,500));
      await w(600);
      if(intro){ const rg=zringG; zoomIntro(Z,rg,w,code).catch(()=>{}); }
      // fast replay: one even beat per event across the week; the header clock sweeps the days with it
      let cNew=0, cEv=0;
      const beat=ZOOM_REPLAY_MS/Math.max(evs.length,1);
      await new Promise(done=>{ let i=0; const tm=d3.timer(el=>{
        if(my!==sceneId){ tm.stop(); done(); return; }
        while(i<evs.length && i*beat<=el){
          const e=evs[i++], n=codeMap.get(e[0]), o=sub.get(e[0]);
          cEv++; setHead(cNew,cEv); if(o){ o.ev++; paintSub(o); }
          if(!n) continue;
          if(e[1]) zoomSpark(n,e[0],apex,k,()=>{ cNew++; setHead(cNew,cEv); if(o){ o.nNew++; paintSub(o); } });
          else { fileRipple(n); flickerBar(e[0],0); }
        }
        if(i>=evs.length){ tm.stop(); done(); } }); });
      await w(950);              // the last sparks finish landing so the numbers are final
      zui.classList.add("final");   // then underline them for the closing hold
      await w(ZOOM_HOLD_MS);
      completed=true;
    } catch(err){ if(err!==CANCELLED) throw err;
    } finally { if(my===sceneId){
      zui.classList.remove("final");
      // zoom out: restore the main loop's state exactly as it was, and bring the atlas back
      zui.classList.remove("on"); zsubs.classList.remove("on"); annOut();
      await w(150).catch(()=>{});      // the text has started to fade; the zoom-out follows right behind it
      if(my===sceneId){
      stage.classList.remove("zoomed");   // events log, counter and timeline return together with the atlas
      if(snap.live){ live.clear(); snap.live.forEach((v,key)=>live.set(key,v)); root.each(n=>{ n.liveSub=snap.sub.get(n); }); }
      nodeSel.select("circle").transition().duration(ZOOM_OUT_MS).attr("r",d=>nodeR(d));
      leaves.forEach(d=>drawBar(d,ZOOM_OUT_MS));
      g.transition().duration(ZOOM_OUT_MS).ease(d3.easeCubicOut).attr("transform",home);
      const back=g.selectAll(".zout");
      back.classed("zback",true).classed("zout",false);
      setTimeout(()=>back.classed("zback",false),700);
      sparkL.classed("zout",false); pulseL.classed("zout",false);
      setClock(vt);
      }
      await w(ZOOM_OUT_MS+150).catch(()=>{});
      if(my===sceneId){ paused=false; busy=false; sceneReset=null; }
    } }
    return completed;
  }

  // ── recap scene: the top sites side by side, at the end of every loop
  // One stacked bar per site on a single scale: its events this week, split into new-sample arrivals
  // (orange, from the shared baseline so they compare directly) and file updates (green). The scene
  // walks the viewer through how to read it, then calls out the fastest-growing site.
  const baseBySite=new Map();
  Object.entries(B.base||{}).forEach(([k,v])=>{ const r=rootOf(shown(k)); if(r) baseBySite.set(r,(baseBySite.get(r)||0)+v); });
  const recapRows=[...zoomRank.entries()].sort((a,b)=>a[1]-b[1]).map(([code])=>{
    const evs=siteEvents.get(code), nNew=newIn(evs), start=baseBySite.get(code)||0;
    return {code,name:codeMap.get(code).data.name,events:evs.length,nNew,nUpd:evs.length-nNew,start,end:start+nNew,
      growth:start?100*nNew/start:0}; });
  const RC_BAR_W=380, RC_STEPS=[   // guided walkthrough: what to highlight, which part to point at, what to say, how long to stay
    {focus:"all",   add:[],           ms:4000, target:null, title:"How to read this",
      body:"Each bar is one body site's activity this week. The longer the bar, the more events."},
    {focus:"new",   add:["show-new"], ms:4200, target:".rc-row:last-child .seg-new", title:"New patient samples",
      body:"Each orange block is a sample reaching the pipeline for the first time."},
    {focus:"upd",   add:["show-upd"], ms:4200, target:".rc-row:last-child .seg-upd", title:"Updates to existing samples",
      body:"Green is the rest of the activity: files landing, passing quality checks and loading."},
    {focus:"all",   add:["show-se"],  ms:4400, target:".rc-row:last-child .rc-se", title:"Total patient samples",
      body:"Each site's total at the start and the end of the week, with the change."},
    {focus:"growth",add:[],           ms:5000, target:".rc-row.hl .rc-se", title:null,
      body:"Growth is a site's new samples as a share of its own starting total."} ];
  const rc=document.getElementById("recap"), rcNote=document.getElementById("rc-note"), rcPath=document.getElementById("rc-arrow-path");
  const rcT=document.getElementById("rc-note-t"), rcB=document.getElementById("rc-note-b"), rcCard=document.getElementById("rc-card");
  let rcBest=null;
  function buildRecap(){
    const max=d3.max(recapRows,r=>r.events)||1, px=v=>(v/max*RC_BAR_W).toFixed(1)+"px";
    document.getElementById("rc-chart").innerHTML=recapRows.map((r,i)=>
      `<div class="rc-row" data-code="${r.code}" style="--i:${i}"><div class="rc-name"><span class="rk">${i+1}</span>${r.name}</div>`+
      `<div class="rc-bar"><div class="seg-new" style="--w:${px(r.nNew)};--i:${i}"><span class="lab">${fmt(r.nNew)}</span></div>`+
      `<div class="seg-upd" style="--w:${px(r.nUpd)};--i:${i}"><span class="lab">${fmt(r.nUpd)}</span></div><span class="rc-tot">${fmt(r.events)}</span></div>`+
      `<div class="rc-se">${fmt(r.start)} → <span class="e">${fmt(r.end)}</span><span class="d">+${r.nNew}</span></div></div>`).join("");
    rcBest=recapRows.reduce((a,b)=>b.growth>a.growth?b:a);
    rc.querySelector(`.rc-row[data-code="${rcBest.code}"]`).classList.add("hl");
    RC_STEPS[RC_STEPS.length-1].title=`Fastest growing: ${rcBest.name}, +${rcBest.growth.toFixed(2)}%`;
  }
  // put the note under the chart and draw a curved arrow from it up to the part of the chart it explains
  function placeNote(st){
    const rr=rc.getBoundingClientRect(), k=(rr.width/rc.offsetWidth)||1, rw=rc.offsetWidth, nw=390;
    const cardBottom=(rcCard.getBoundingClientRect().bottom-rr.top)/k, noteTop=cardBottom+62;
    rcT.textContent=st.title; rcB.textContent=st.body;
    const tgt=st.target&&rc.querySelector(st.target), tr=tgt&&tgt.getBoundingClientRect();
    if(!tgt||!tr||!tr.width){ rcNote.style.left=((rw-nw)/2)+"px"; rcNote.style.top=(cardBottom+34)+"px"; rcNote.style.textAlign="center"; return null; }
    const tx=(tr.left+tr.width/2-rr.left)/k, ty=(tr.bottom-rr.top)/k+8, dir=tx<rw*.6?1:-1;
    const left=Math.max(0,Math.min(rw-nw,tx-(dir>0?40:nw-40)));
    rcNote.style.left=left+"px"; rcNote.style.top=noteTop+"px"; rcNote.style.textAlign="left";
    const sx=tx+dir*74, sy=noteTop-10;
    return `M${sx.toFixed(1)},${sy.toFixed(1)} C${sx.toFixed(1)},${(sy-52).toFixed(1)} ${(tx+dir*40).toFixed(1)},${(ty+58).toFixed(1)} ${tx.toFixed(1)},${ty.toFixed(1)}`;
  }
  async function showNote(st,w){
    rcNote.style.opacity=0; rcPath.style.opacity=0; await w(350);
    const d=placeNote(st); rcNote.style.opacity=1; await w(350);
    if(d){ rcPath.setAttribute("d",d); const len=rcPath.getTotalLength?rcPath.getTotalLength():0;
      rcPath.style.transition="none"; rcPath.style.strokeDasharray=len||"none"; rcPath.style.strokeDashoffset=len||0; rcPath.style.opacity=1;
      void rcPath.getBoundingClientRect();
      rcPath.style.transition="stroke-dashoffset .8s ease-out"; rcPath.style.strokeDashoffset=0; }
  }

  async function runRecap(){
    busy=true; buildRecap();
    const my=++sceneId, w=sceneWait(my); sceneReset=()=>hardReset(null,null);
    let completed=false;
    rc.className=""; rc.setAttribute("data-focus","all"); rcNote.style.opacity=0; rcPath.style.opacity=0;
    const atlasEl=document.getElementById("atlas"), titleRow=document.querySelector(".titlerow");
    const gapUp=Math.max(0,atlasEl.offsetTop-(titleRow.offsetTop+titleRow.offsetHeight)-72);
    rc.style.top=(8-gapUp)+"px";
    const fadeSel=g.selectAll(".ringline,.spoke,.hubc,.hub-tot,.hub-num,.hub-lab,.hub-cat,.catlabel,.link,.node");
    try{
      // the atlas and every panel around it step back; the recap arrives once they are gone
      fadeSel.classed("zout",true); barSel.classed("zout",true); tipSel.classed("zout",true);
      wedge.classed("zout",true); sparkL.classed("zout",true); pulseL.classed("zout",true);
      stage.classList.add("zoomed","recapping");
      rc.classList.add("on");
      await w(1200);
      rc.classList.add("bars");
      await w(1900);
      for(const st of RC_STEPS){
        rc.setAttribute("data-focus",st.focus); st.add.forEach(c=>rc.classList.add(c));
        await showNote(st,w);
        await w(st.ms);
      }
      completed=true;
    } catch(err){ if(err!==CANCELLED) throw err;
    } finally { if(my===sceneId){
      rcNote.style.opacity=0; rcPath.style.opacity=0; rc.classList.remove("on");
      await w(150).catch(()=>{});
      if(my===sceneId){
      stage.classList.remove("zoomed","recapping");
      const back=g.selectAll(".zout"); back.classed("zback",true).classed("zout",false);
      setTimeout(()=>back.classed("zback",false),700);
      }
      await w(700).catch(()=>{});
      if(my===sceneId){ rc.className=""; busy=false; sceneReset=null; }
    } }
    return completed;
  }

  // ── debug buttons (bottom left): jump straight to the recap or the first zoom without sitting through the loop.
  // They only call the same zoom/recap code the loop uses; the loop is paused meanwhile and carries on exactly where it was.
  function debugRecap(){
    cancelScene();   // takes over from a zoom/recap that is already playing
    paused=true;
    runRecap().then(ok=>{ if(ok) paused=false; }).catch(err=>{ console.error(err); paused=false; busy=false; });
  }
  function debugZoom(){
    cancelScene();
    const c=level1.find(x=>zoomRank.has(x.data.code)); if(!c) return;   // first top site in the clockwise order
    const saved=si; si=level1.indexOf(c); spotlight(); si=saved;        // show its spotlight without moving the rotation
    zoomSite(c,{debug:true}).catch(err=>{ console.error(err); paused=false; busy=false; stage.classList.remove("zoomed"); });
  }
  document.getElementById("dbg-recap").addEventListener("click",debugRecap);
  document.getElementById("dbg-zoom").addEventListener("click",debugZoom);

  // spotlight scheduler: every site gets its short spotlight; a top site is zoomed into after a moment
  function cycle(){
    if(busy){ setTimeout(cycle,400); return; }   // a zoom/recap is playing: leave the spotlight where it is
    spotlight();
    const c=level1.find(x=>x.data.code===curSpot);
    if(!reduce && c && !busy && zoomRank.has(curSpot)){
      (async()=>{
        try{ await zoomSite(c); }catch(err){ console.error(err); paused=false; busy=false; stage.classList.remove("zoomed"); }
        setTimeout(cycle,1200);
      })();
    } else setTimeout(cycle, reduce?9000:5600);
  }
  cycle();
})();
