// Scene director: plays the atlas as an ordered story instead of three independent timers.
//   Scene 1  INTRO       simplified layout + a larger tree; each element is introduced with an annotation while the week plays behind it
//   Scene 2  HIGHLIGHTS  the two most active sites, one zoom each, on purpose; then the wrap-up note
//   Scene 3  SUMMARY     the top-5 recap (to be replaced by the dashboard)
// Everything goes through the Atlas control surface that app.js exposes. Open the page with ?classic to skip the
// director and run the original self-driven loop.
(function(){
  "use strict";
  const A=window.Atlas, Anno=window.Anno, B=window.BUNDLE;
  if(!A||A.classic||A.reduce) return;

  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const ABORT={};
  let epoch=0;                                   // bumped whenever a debug button takes over: the running story stops at its next step

  // scene timings (seconds of running time unless noted)
  const T={ introTo:.55, introMs:50000, settleMs:1800, eventsAfterNoteMs:1500, loopMs:4500, startNoteMs:4500, ringsMs:4000, circleMs:7500, rippleMs:8500, gapMs:1200, beforeZoomMs:1500, pauseMs:4000, pauseTo:.62, wrapTo:.97, wrapMs:12000,
            noteHoldMs:6500, finishMs:4000, sparksMs:3500, firstReplayMs:15000, secondReplayMs:10000 };
  Object.assign(T,window.StoryTimings||{});      // optional overrides, e.g. window.StoryTimings={introMs:20000} before this file loads, for tuning

  async function highlight(code,opts,chk){
    await A.spotlight.goTo(code);                // the slice fades over to the site once; the sweep itself stays off
    await sleep(T.beforeZoomMs); chk();
    const ok=await A.scenes.zoom(code,opts); chk();
    A.spotlight.clear();
    return ok;
  }

  async function story(my,from){
    const chk=()=>{ if(my!==epoch) throw ABORT; };
    A.stream.manual(true); A.stream.restart(); A.spotlight.autoZoom(false);
    if(from===1){ A.spotlight.start();

    // Scene 1: teach the picture, one element at a time. The week plays behind the notes (the tree dims, events keep landing).
    await sleep(T.settleMs); chk();
    const note1=Anno.show({target:"#gr-start",html:"Total <b>patient samples</b> we started the week with.",place:"below",gap:60,maxW:250,balance:true,align:"left",box:true});
    await sleep(T.eventsAfterNoteMs); chk();
    const week=A.stream.runTo(T.introTo,T.introMs);            // the events begin shortly after the first note starts, and play on behind the rest
    await note1; chk(); await sleep(T.startNoteMs); chk(); Anno.clear();
    await sleep(T.loopMs); chk();

    A.intro.dim("tree"); A.intro.rings(true); A.intro.ringLabels(true); await sleep(900); chk();         // the body-site names get their orange rings
    const ang=0.78, ptr=A.intro.pt(ang,A.intro.ringOut);
    await Anno.show({target:ptr,glow:false,html:"We have cancer samples for <b>32 body sites</b>.",place:"above",gap:96,dx:30,maxW:240,align:"left",box:true}); chk();
    await sleep(T.ringsMs); chk(); Anno.clear(); A.intro.rings(false); A.intro.ringLabels(false); A.intro.dim(null); await sleep(T.gapMs+600); chk();

    const [big,rip]=A.intro.bySamples();                                   // the biggest circle: bigger circle = more samples
    A.intro.dim("all"); const circ=A.intro.keep(big); await sleep(700); chk();
    const cb=circ.getBoundingClientRect(), left=(cb.left+cb.width/2)<window.innerWidth/2;
    await Anno.show({target:circ,round:true,pad:[9,9],html:"Each circle represents a <b>cancer type</b>.<br><br>The bigger the circle, the more samples we have.",
      place:"auto",gap:70,lift:64,maxW:330,margin:56,up:true,align:"left",box:true}); chk();
    await sleep(T.circleMs); chk(); Anno.clear(); A.intro.keep(null); A.intro.dim(null); await sleep(T.gapMs+600); chk();

    A.intro.dim("all"); const circ2=A.intro.keep(rip); A.intro.ripple(rip); await sleep(900); chk();   // a ripple held in place
    const cb2=circ2.getBoundingClientRect(), left2=(cb2.left+cb2.width/2)<window.innerWidth/2;
    await Anno.show({target:circ2,round:true,pad:[9,9],html:"Each ripple is an <b>event</b>: something happened to a sample.<br><br>A new sample arrives, or one of its files is updated.",
      place:"right",gap:70,lift:64,maxW:300,margin:56,up:true,align:"left",box:true}); chk();
    await sleep(T.rippleMs); chk(); Anno.clear(); A.intro.ripple(null); A.intro.keep(null); A.intro.dim(null); await sleep(T.gapMs+600); chk();

    await week; chk();                                                         // the week keeps playing until its intro share is done
    A.spotlight.stop(); await sleep(600); chk();             // the lit slice stays; it fades straight into the first site's slice (no blank in between)
    } else {                                                                   // jumped past the intro: the week is brought to where the intro leaves it
      A.spotlight.stop(); A.spotlight.clear();
      await A.stream.runTo(from===2?T.introTo:1,900); chk(); await sleep(400); chk();
    }

    if(from<=2){
    // Scene 2: the two most active sites. The first teaches how to read the zoom; the second is reinforcement.
    const [first,second]=A.rank.top(2);
    await highlight(first,{annotate:true,replayMs:T.firstReplayMs},chk);
    const trickle=A.stream.runTo(T.pauseTo,T.pauseMs);       // neutral overview: events keep trickling while viewers regain their bearings
    await sleep(T.pauseMs); await trickle; chk();
    await highlight(second,{annotate:false,replayMs:T.secondReplayMs},chk);

    // wrap-up: the week plays to its very end; only then does the note say what it added (read from the bar itself)
    await A.stream.runTo(1,T.wrapMs+T.finishMs); chk();
    await sleep(T.sparksMs); chk();                          // the last sparks land
    const added=(document.getElementById("gr-delta").textContent||"").replace(/\s*new\s*$/,"").trim();
    await Anno.show({target:"#gr-end",html:`By the end of the week, we had <b style="color:var(--orange-text)">${added}</b> new samples.`,place:"below",gap:60,box:true,maxW:300,align:"center"}); chk();
    await sleep(T.noteHoldMs); chk();
    Anno.clear();
    }

    // Scene 3
    A.stream.pause();
    const ok=await A.scenes.summary().catch(err=>{ console.error(err); return true; }); chk();
    if(ok){ A.stream.resume(); }
  }

  // the small 1 / 2 / 3 buttons jump to a scene: whatever is playing stops and the story picks up at that scene
  let startAt=1;
  function jump(n){ startAt=n; epoch++; Anno.clear(true); A.intro.reset(); A.scenes.cancel(); }
  const dbg=document.querySelector(".dbg");
  if(dbg){ dbg.hidden=false; dbg.querySelectorAll("button").forEach(b=>b.addEventListener("click",()=>jump(+b.dataset.scene))); }

  async function run(){
    for(;;){
      const my=++epoch, from=startAt; startAt=1;
      try{ await story(my,from); }
      catch(err){ if(err!==ABORT) console.error(err); Anno.clear(true); A.intro.reset(); await A.scenes.idle(); }
    }
  }
  run();
})();
