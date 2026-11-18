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
  g.append("g").selectAll("circle").data(RING.slice(1)).enter().append("circle")
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
  g.append("circle").attr("r",HUB_R).attr("fill",P.surface).attr("filter","url(#lift)");
  g.append("circle").attr("r",HUB_R).attr("fill","none").attr("stroke",P.hair).attr("stroke-width",1);
  g.append("circle").attr("r",HUB_R-9).attr("fill","none").attr("stroke",P.hair).attr("stroke-width",.75).attr("stroke-dasharray","1.5 3.5");
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
  function restartLoop(){
    gen++; resetCounts(); total=B.meta.baseSamples??total; setTotal(total);
    nodeSel.select("circle").transition().duration(1500).attr("r",d=>nodeR(d));
    leaves.forEach(d=>drawBar(d,1500));
    growthReset();
  }
  function arrive(node,code,g0){
    if(g0!==gen) return;
    pulseL.append("circle").attr("cx",node.px).attr("cy",node.py).attr("r",nodeR(node)+2)
      .attr("fill",P.created).attr("opacity",.28).transition().duration(700).attr("opacity",0).attr("r",nodeR(node)).remove();
    pulseL.append("circle").attr("cx",node.px).attr("cy",node.py).attr("r",nodeR(node)+2)
      .attr("fill","none").attr("stroke",P.created).attr("stroke-width",2.2).attr("opacity",.9)
      .transition().duration(1300).ease(d3.easeCubicOut)
      .attr("r",nodeR(node)+38).attr("opacity",0).attr("stroke-width",.4).remove();
    flickerBar(code,1); grow(code);
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
    if(ei===N) holdUntil=(lastTs??performance.now())+SPARK_MS+4500;   // let the last sparks land, show today's total, then start over
  }
  function frame(ts){
    if(lastTs===null) lastTs=ts;
    const dt=Math.min(ts-lastTs,250); lastTs=ts;
    if(holdUntil){ if(ts<holdUntil){ growthTick(); requestAnimationFrame(frame); return; }
      holdUntil=0; ei=0; vt=0; restartLoop(); }
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
  spotlight(); setInterval(spotlight, reduce?9000:5600);
})();
