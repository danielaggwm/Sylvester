/* Sample Atlas — visualization code. Data comes from data/bundle.js (window.BUNDLE). */
(function(){
  const B = window.BUNDLE, fmt = d3.format(","), reduce = matchMedia("(prefers-reduced-motion:reduce)").matches;
  const VC = ["var(--v1)","var(--v2)","var(--v3)","var(--v4)","var(--v5)"];
  const VCHEX = ["#3987e5","#d95926","#199e70","#c98500","#d55181"];

  // scale stage to viewport
  const stage = document.getElementById("stage");
  function fit(){ const s=Math.min(innerWidth/1080, innerHeight/1920);
    stage.style.transform=`translate(-50%,-50%) scale(${s})`; }
  addEventListener("resize",fit); fit();

  // ── header kpis
  document.getElementById("k-cats").textContent = B.meta.nCategories;
  document.getElementById("k-files").textContent = fmt(B.meta.totalFiles);
  const M=B.meta, nd=d3.utcFormat("%b %-d, %Y"), D0=new Date(M.tStart), D1=new Date(M.tEnd);
  document.getElementById("foot-src").textContent =
    `Replaying last ${Math.round(M.windowDays)} days · ${fmt(M.eventsInWindow)} events · synthetic sample`;
  const perEv=((M.loopMin*60)/M.eventsInWindow).toFixed(1), perDay=(M.loopMin*60)/M.windowDays;
  const perDayTxt=perDay>=90?`${(perDay/60).toFixed(1).replace(/\.0$/,"")} minutes`:`${Math.round(perDay)} seconds`;
  document.getElementById("tip-even").innerHTML=`<b>Even pace.</b> The ${fmt(M.eventsInWindow)} events from the last ${Math.round(M.windowDays)} days play one at a time, about one every ${perEv} s, so each one is easy to follow. The events and their order are real; only the spacing is evened out.`;
  document.getElementById("tip-real").innerHTML=`<b>Real timing.</b> The same events keep their real gaps from the pipeline log. ${nd(D0)} – ${nd(D1)} plays in a ${M.loopMin}-minute loop, so one day takes about ${perDayTxt}. Overnight batches arrive as bursts; quiet hours and weekends go still. Circles start at their size on ${nd(D0)} and grow to today's totals.`;

  // ── build hierarchy + radial layout
  const W=1080; let H=document.getElementById("atlas").clientHeight||1100;
  const root = d3.hierarchy(B.tree);
  const RING=[0,168,248,312,360,396,420];
  const OUT=420;
  const rOf = d=> d===0?0 : RING[Math.min(d,RING.length-1)];
  const cluster = d3.cluster().size([2*Math.PI,1]).separation((a,b)=>(a.parent===b.parent?1:1.35));
  cluster(root);
  const maxSub = d3.max(root.descendants().filter(d=>d.depth>0), d=>d.data.n_subtree||1);
  const sizeScale = d3.scaleSqrt().domain([1,maxSub]).range([1.6,16.5]).clamp(true);
  const nodeR = d=> d.depth===0?0 : sizeScale(Math.max(1,d.liveSub||0));
  root.each(n=>{ n.ang=n.x; n.rr=rOf(n.depth);
    n.px=Math.sin(n.ang)*n.rr; n.py=-Math.cos(n.ang)*n.rr; });

  // code -> node ; level1 -> subtree code set + angular extent
  const codeMap=new Map(); root.each(n=>codeMap.set(n.data.code,n));
  // live sample counts: start at the state before the replay window, grow as samples arrive
  const live=new Map();
  function resetCounts(){ live.clear(); Object.entries(B.base||{}).forEach(([k,v])=>live.set(k,v));
    root.eachAfter(n=>{ n.liveSub=(live.get(n.data.code)||0)+(n.children?d3.sum(n.children,c=>c.liveSub):0); }); }
  resetCounts();
  const subtreeCodes=new Map(), extent=new Map();
  root.children.forEach(c=>{ const s=new Set(); let a0=Infinity,a1=-Infinity;
    c.descendants().forEach(d=>{ s.add(d.data.code); a0=Math.min(a0,d.ang); a1=Math.max(a1,d.ang); });
    subtreeCodes.set(c.data.code,s); extent.set(c.data.code,[a0,a1]); });

  // ── svg scaffold
  const svg=d3.select("#atlas").append("svg").attr("viewBox",`0 0 ${W} ${H}`);
  const defs=svg.append("defs");
  const hg=defs.append("radialGradient").attr("id","hub");
  hg.append("stop").attr("offset","0%").attr("stop-color","#123049").attr("stop-opacity",.95);
  hg.append("stop").attr("offset","70%").attr("stop-color","#0b1a2c").attr("stop-opacity",.9);
  hg.append("stop").attr("offset","100%").attr("stop-color","#0b1a2c").attr("stop-opacity",0);
  const ng=defs.append("radialGradient").attr("id","nodeg");
  ng.append("stop").attr("offset","0%").attr("stop-color","#bfeefb");
  ng.append("stop").attr("offset","55%").attr("stop-color","#5fcbe4");
  ng.append("stop").attr("offset","100%").attr("stop-color","#2f8aa6");
  const glow=defs.append("filter").attr("id","glow").attr("x","-80%").attr("y","-80%").attr("width","260%").attr("height","260%");
  glow.append("feGaussianBlur").attr("stdDeviation","3.2").attr("result","b");
  const fm=glow.append("feMerge"); fm.append("feMergeNode").attr("in","b"); fm.append("feMergeNode").attr("in","SourceGraphic");

  const g=svg.append("g");
  // concentric rings
  g.append("g").selectAll("circle").data(RING.slice(1)).enter().append("circle")
    .attr("class","ringline").attr("r",d=>d);
  // faint spokes at level-1 boundaries
  g.append("g").selectAll("line").data(root.children).enter().append("line")
    .attr("class","spoke")
    .attr("x1",d=>Math.sin(d.ang-Math.PI/B.meta.nCategories)*112)
    .attr("y1",d=>-Math.cos(d.ang-Math.PI/B.meta.nCategories)*112)
    .attr("x2",d=>Math.sin(d.ang-Math.PI/B.meta.nCategories)*462)
    .attr("y2",d=>-Math.cos(d.ang-Math.PI/B.meta.nCategories)*462);

  // wedge (spotlight) layer
  const wedge=g.append("path").attr("fill","rgba(255,194,74,.07)").attr("stroke","rgba(255,194,74,.22)").attr("stroke-width",1).attr("opacity",0);
  const arcGen=(a0,a1)=>d3.arc()({innerRadius:104,outerRadius:466,startAngle:a0-0.03,endAngle:a1+0.03});

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
    .attr("fill",d=>d.depth===1?"url(#nodeg)":"#4fb4cf")
    .attr("opacity",d=>d.depth===1?.96:.66)
    .attr("filter",d=>d.depth===1?"url(#glow)":null);

  // outer data band: one radial bar per subtype, length = samples coded to it
  const leaves=root.leaves();
  const barLen=d3.scaleLog().domain([1,d3.max(leaves,d=>d.data.n_direct||1)]).range([3,30]).clamp(true);
  const barL=d=>{const v=live.get(d.data.code)||0; return v<1?0:barLen(v);};
  const barSel=g.append("g").selectAll("line").data(leaves).enter().append("line")
    .attr("data-root",d=>d.ancestors().find(a=>a.depth===1).data.code)
    .attr("x1",d=>Math.sin(d.ang)*(OUT+9)).attr("y1",d=>-Math.cos(d.ang)*(OUT+9))
    .attr("x2",d=>Math.sin(d.ang)*(OUT+9+barL(d))).attr("y2",d=>-Math.cos(d.ang)*(OUT+9+barL(d)))
    .attr("stroke","#5fcbe4").attr("stroke-width",1.6).attr("stroke-linecap","round").attr("opacity",.4);
  const leafByCode=new Map(leaves.map(d=>[d.data.code,d]));
  const tipSel=g.append("g").selectAll("circle").data(leaves).enter().append("circle")
    .attr("data-root",d=>d.ancestors().find(a=>a.depth===1).data.code)
    .attr("cx",d=>Math.sin(d.ang)*(OUT+12+barL(d))).attr("cy",d=>-Math.cos(d.ang)*(OUT+12+barL(d)))
    .attr("r",1.3).attr("fill","#bfeefb").attr("opacity",.45);

  // category labels: curved along the outer edge (top half reads clockwise, bottom half flipped upright)
  const SHORT={"Peripheral Nervous System":"Periph. Nerve","Bladder/Urinary Tract":"Bladder",
    "Ovary/Fallopian Tube":"Ovary","Esophagus/Stomach":"Esophagus","Ampulla of Vater":"Ampulla","Biliary Tract":"Biliary","Head and Neck":"Head & Neck","Adrenal Gland":"Adrenal"};
  const angDist=(a,b)=>{const d=Math.abs(a-b)%(2*Math.PI);return Math.min(d,2*Math.PI-d)};
  const LR=480, labelG=g.append("g"), lblInfo=[];
  root.children.forEach(c=>{
    const a=c.ang, top=Math.cos(a)>=0, r=top?LR:LR+11, d=0.62;
    const P=x=>[Math.sin(x)*r,-Math.cos(x)*r];
    const [x0,y0]=P(top?a-d:a+d), [x1,y1]=P(top?a+d:a-d);
    defs.append("path").attr("id","lp-"+c.data.code).attr("d",`M${x0},${y0} A${r},${r} 0 0 ${top?1:0} ${x1},${y1}`);
    const ld=labelG.append("line").attr("class","leader").attr("data-root",c.data.code).attr("opacity",0)
      .attr("x1",Math.sin(a)*(c.rr+nodeR(c)+3)).attr("y1",-Math.cos(a)*(c.rr+nodeR(c)+3))
      .attr("x2",Math.sin(a)*(LR-14)).attr("y2",-Math.cos(a)*(LR-14));
    const tx=labelG.append("text").attr("class","catlabel").attr("data-root",c.data.code).attr("opacity",0);
    tx.append("textPath").attr("href","#lp-"+c.data.code).attr("startOffset","50%").attr("text-anchor","middle")
      .text(SHORT[c.data.name]||c.data.name);
    lblInfo.push({c,el:tx.node(),ld:ld.node()});
  });
  // keep a label only if its arc doesn't collide with a bigger site's label; the spotlit site always wins
  function cullLabels(spot){
    const prev=lblInfo.map(o=>o.el.style.fontSize);
    lblInfo.forEach(o=>o.el.style.fontSize="14.5px");
    const items=lblInfo.map(o=>{let len=80;try{len=o.el.getComputedTextLength()||80}catch(e){}
      const isSpot=o.c.data.code===spot; return {o,isSpot,L:isSpot?len*18/14.5:len};});
    lblInfo.forEach((o,i)=>o.el.style.fontSize=prev[i]);
    items.sort((a,b)=>(b.isSpot-a.isSpot)||(b.o.c.data.n_subtree-a.o.c.data.n_subtree));
    const kept=[];
    items.forEach(it=>{ if(kept.every(k=>angDist(k.o.c.ang,it.o.c.ang)*LR>=(k.L+it.L)/2+14)) kept.push(it); });
    const ks=new Set(kept.map(k=>k.o.c.data.code));
    lblInfo.forEach(o=>{const v=ks.has(o.c.data.code)?1:0; o.el.setAttribute("data-shown",v); o.ld.setAttribute("data-shown",v);});
  }
  cullLabels(null);
  labelG.selectAll(".catlabel").attr("opacity",function(){return this.getAttribute("data-shown")==="1"?.75:0});
  labelG.selectAll(".leader").attr("opacity",function(){return this.getAttribute("data-shown")==="1"?.6:0});

  // hub
  g.append("circle").attr("r",104).attr("fill","url(#hub)");
  g.append("circle").attr("r",92).attr("fill","none").attr("stroke","rgba(120,180,230,.25)").attr("stroke-width",1);
  g.append("circle").attr("r",99).attr("fill","none").attr("stroke","rgba(120,180,230,.12)").attr("stroke-width",1);
  const hubNum=g.append("text").attr("class","hub-num").attr("dy","-2").text("0");
  g.append("text").attr("class","hub-lab").attr("dy","20").text("Patient samples");
  const hubCat=g.append("text").attr("class","hub-cat").attr("dy","52").text("");

  const pulseL=g.append("g"); // pulses on top

  // fit the whole atlas (labels at their largest spotlight size) into the space left by the panels
  function fitAtlas(){
    H=document.getElementById("atlas").clientHeight||H;
    svg.attr("viewBox",`0 0 ${W} ${H}`);
    const lbls=labelG.selectAll(".catlabel").nodes(), prev=lbls.map(n=>n.style.fontSize);
    lbls.forEach(n=>n.style.fontSize="18px");
    const bb=g.node().getBBox();
    lbls.forEach((n,i)=>n.style.fontSize=prev[i]);
    const halfW=Math.max(-bb.x,bb.x+bb.width), halfH=Math.max(-bb.y,bb.y+bb.height), m=16;
    const s=Math.min((W/2-m)/halfW,(H/2-m)/halfH);
    g.attr("transform",`translate(${W/2},${H/2}) scale(${s.toFixed(4)})`);
  }
  fitAtlas();
  if(document.fonts&&document.fonts.ready) document.fonts.ready.then(()=>{ cullLabels(curSpot); fitAtlas();
    labelG.selectAll(".catlabel").attr("opacity",function(){return this.getAttribute("data-root")===curSpot?1:(this.getAttribute("data-shown")==="1"?.5:0)});
    labelG.selectAll(".leader").attr("opacity",function(){return this.getAttribute("data-root")===curSpot?1:(this.getAttribute("data-shown")==="1"?.35:0)}); });

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
      .attr("stroke",role?"#ffe7a3":"#b6f2ff").attr("stroke-width",role?4:3).attr("stroke-linecap","round")
      .attr("opacity",1).style("filter","drop-shadow(0 0 4px "+(role?"#ffd96b":"#55cfe8")+")")
      .transition().duration(role?1300:950).ease(d3.easeCubicIn).attr("opacity",0).remove();
  }

  // blue ripple: a file moved through the pipeline
  function fileRipple(node){
    pulseL.append("circle").attr("cx",node.px).attr("cy",node.py).attr("r",nodeR(node)+1.5)
      .attr("fill","none").attr("stroke","#55cfe8").attr("stroke-width",1.3).attr("opacity",.6)
      .transition().duration(950).ease(d3.easeCubicOut)
      .attr("r",nodeR(node)+15).attr("opacity",0).attr("stroke-width",.4).remove();
  }

  // gold spark: a new sample leaves the center and joins its cancer type
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
  }
  function arrive(node,code,g0){
    if(g0!==gen) return;
    pulseL.append("circle").attr("cx",node.px).attr("cy",node.py).attr("r",nodeR(node)+2)
      .attr("fill","#fff3c9").attr("opacity",.95).transition().duration(700).attr("opacity",0).attr("r",nodeR(node)).remove();
    pulseL.append("circle").attr("cx",node.px).attr("cy",node.py).attr("r",nodeR(node)+2)
      .attr("fill","none").attr("stroke","#ffd96b").attr("stroke-width",2.4).attr("opacity",.95)
      .transition().duration(1300).ease(d3.easeCubicOut)
      .attr("r",nodeR(node)+38).attr("opacity",0).attr("stroke-width",.4).remove();
    flickerBar(code,1); grow(code);
    total++; setTotal(total); d3.select(kS).interrupt();
  }
  function spark(node,code){
    const g0=gen; if(!SPARK_MS){ arrive(node,code,g0); return; }
    // comet = head + 4 fading followers on the same path, each slightly behind
    const trail=[{r:4.6,o:1,lag:0,f:"#fff1c2"},{r:3.6,o:.6,lag:55,f:"#ffd96b"},{r:2.9,o:.4,lag:110,f:"#ffd96b"},{r:2.2,o:.25,lag:170,f:"#ffc24a"},{r:1.6,o:.14,lag:240,f:"#ffc24a"}];
    trail.forEach((p,i)=>{
      const c=sparkL.append("circle").attr("r",p.r).attr("fill",p.f).attr("opacity",0).attr("cx",0).attr("cy",0);
      if(i===0) c.style("filter","drop-shadow(0 0 6px #ffd96b)");
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
    const role=e[1], col=role?"#ffd96b":"#55cfe8";
    row.innerHTML=`<span class="ic" style="background:${col};box-shadow:0 0 8px ${col}"></span>`+
      `<span class="cd">${role?"NEW SAMPLE":"File update"} · ${e[0]}</span>`+
      `<span class="vn">${B.vendors[e[2]]}</span>`;
    tick.prepend(row);
    while(tick.children.length>4) tick.lastElementChild.remove();
  }

  // ── pipeline clock
  const t0=Date.parse(B.meta.tStart), t1=Date.parse(B.meta.tEnd);
  const fDay=new Intl.DateTimeFormat("en-US",{timeZone:"America/New_York",weekday:"short",month:"short",day:"numeric",year:"numeric"});
  const fTime=new Intl.DateTimeFormat("en-US",{timeZone:"America/New_York",hour:"2-digit",minute:"2-digit",hour12:false});
  const clockEl=document.getElementById("clock-date"), progEl=document.getElementById("prog");
  function setClock(tn){ const d=new Date(t0+tn*(t1-t0));
    clockEl.textContent=`${fDay.format(d)} · ${fTime.format(d)} ET`; progEl.style.width=(tn*100).toFixed(2)+"%"; }

  // ── event engine: two timing modes over the same event list
  const N=B.events.length, LOOP_MS=(B.meta.loopMin||30)*60*1000, EVEN_MS=reduce?900:LOOP_MS/N;
  let mode="even", ei=0, acc=0, vt=B.events[0][3], lastTs=null, holdUntil=0;
  function fire(){
    const e=B.events[ei]; ei=(ei+1)%N;
    const n=codeMap.get(e[0]);
    if(n){ if(e[1]) spark(n,e[0]); else { fileRipple(n); flickerBar(e[0],0); } pushTicker(e); }
    evStreamed++; kE.textContent=fmt(evStreamed); setClock(e[3]);
    if(ei===0) holdUntil=performance.now()+SPARK_MS+1900;   // let the last sparks land, show today's total, then start over
  }
  function frame(ts){
    if(lastTs===null) lastTs=ts;
    const dt=Math.min(ts-lastTs,250); lastTs=ts;
    if(holdUntil){ if(ts<holdUntil){ requestAnimationFrame(frame); return; }
      holdUntil=0; vt=B.events[0][3]; acc=0; restartLoop(); }
    if(mode==="even"){
      acc+=dt; let k=0; while(acc>=EVEN_MS && k<3 && !holdUntil){ fire(); acc-=EVEN_MS; k++; }
      if(acc>EVEN_MS*3) acc=0;
    } else {
      vt+=dt/LOOP_MS; let k=0;
      while(k<20 && !holdUntil && B.events[ei][3]<=vt){ fire(); k++; }
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  setClock(B.events[0][3]);

  if(reduce) document.querySelectorAll(".lg svg").forEach(s=>s.pauseAnimations&&s.pauseAnimations());
  const bEven=document.getElementById("m-even"), bReal=document.getElementById("m-real");
  function setMode(m){ mode=m; bEven.setAttribute("aria-pressed",m==="even"); bReal.setAttribute("aria-pressed",m==="real");
    if(m==="real") vt=B.events[ei][3]-1e-6; else acc=0; }
  bEven.addEventListener("click",()=>setMode("even"));
  bReal.addEventListener("click",()=>setMode("real"));

  // ── spotlight
  const catByName=new Map(B.categories.map(c=>[c.root,c]));
  const level1=root.children.slice().sort((a,b)=>b.data.n_subtree-a.data.n_subtree);
  let si=0, curSpot=null;
  const vbars=document.getElementById("vbars");
  function spotlight(){
    const c=level1[si++ % level1.length], code=c.data.code, set=subtreeCodes.get(code);
    curSpot=code; cullLabels(code);
    // dim/highlight
    nodeSel.attr("opacity",d=>set.has(d.ancestors().find(a=>a.depth===1).data.code)?1:.42);
    const isOn=function(){return this.getAttribute("data-root")===code};
    barSel.attr("stroke",function(){return isOn.call(this)?"#ffc24a":"#5fcbe4"}).attr("opacity",function(){return isOn.call(this)?.95:.3});
    tipSel.attr("fill",function(){return isOn.call(this)?"#ffe3a0":"#bfeefb"}).attr("opacity",function(){return isOn.call(this)?1:.35});
    nodeSel.select("circle").attr("fill",d=>{
      const inSet=set.has(d.ancestors().find(a=>a.depth===1).data.code);
      if(!inSet) return d.depth===1?"url(#nodeg)":"#4fb4cf";
      return d.depth===1?"#ffd27a":"#ffc24a";});
    linkSel.attr("opacity",function(){return this.getAttribute("data-root")===code?.95:.32})
      .attr("stroke",function(){return this.getAttribute("data-root")===code?"rgba(255,194,74,.5)":"var(--edge)"});
    labelG.selectAll(".catlabel").attr("fill",function(){return this.getAttribute("data-root")===code?"#ffd27a":"var(--ink-3)"})
      .attr("opacity",function(){return this.getAttribute("data-root")===code?1:(this.getAttribute("data-shown")==="1"?.5:0)})
      .style("font-size",function(){return this.getAttribute("data-root")===code?"18px":"14.5px"});
    labelG.selectAll(".leader").attr("opacity",function(){return this.getAttribute("data-root")===code?1:(this.getAttribute("data-shown")==="1"?.35:0)})
      .attr("stroke",function(){return this.getAttribute("data-root")===code?"rgba(255,194,74,.6)":"rgba(120,165,220,.14)"});
    const ex=extent.get(code); wedge.attr("d",arcGen(ex[0],ex[1])).attr("opacity",1);
    hubCat.text(c.data.name).attr("opacity",0).transition().duration(400).attr("opacity",1);
    // panel
    const cd=catByName.get(c.data.name);
    const sn=document.getElementById("spot-name"); sn.textContent=c.data.name; let fs=40; sn.style.fontSize=fs+"px";
    while(sn.scrollWidth>sn.clientWidth && fs>24){ fs-=2; sn.style.fontSize=fs+"px"; }
    document.getElementById("spot-samples").textContent=fmt(c.liveSub);
    document.getElementById("spot-share").textContent=(100*c.liveSub/total).toFixed(1)+"%";
    document.getElementById("spot-files").textContent=fmt(cd.n_files);
    const maxv=d3.max(B.vendors,v=>cd.vendors[v]||0)||1;
    vbars.innerHTML="";
    B.vendors.forEach((v,i)=>{const n=cd.vendors[v]||0;
      const row=document.createElement("div");row.className="vbar";
      row.innerHTML=`<span class="nm">${v}</span><div class="track"><div class="fill" style="width:0;background:${VCHEX[i]}"></div></div><span class="pc">${fmt(n)}</span>`;
      vbars.appendChild(row);
      requestAnimationFrame(()=>row.querySelector(".fill").style.width=(100*n/maxv)+"%");});
    const subs=c.descendants().filter(d=>d.depth>1).sort((a,b)=>(live.get(b.data.code)||0)-(live.get(a.data.code)||0)).slice(0,3);
    document.getElementById("subs").innerHTML=subs.map(s=>`<div class="sb"><span class="c">${s.data.code}</span><span class="n">${s.data.name}</span><span class="k">${fmt(live.get(s.data.code)||0)}</span></div>`).join("");
  }
  spotlight(); setInterval(spotlight, reduce?9000:5600);
})();
