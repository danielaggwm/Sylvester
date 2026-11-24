// Annotations on the full atlas: a soft yellow glow on the thing being explained, an arrow running from it to
// a short note, and the note stays until it is cleared. Used by the scene director (js/director.js).
(function(){
  "use strict";
  const stage=document.getElementById("stage"), layer=document.getElementById("anno"), under=document.getElementById("anno-under"), svg=layer.querySelector("svg");
  const NS="http://www.w3.org/2000/svg";
  let items=[];

  // position of an element in stage pixels (the stage is scaled to the screen, so undo that scale)
  function rect(el){
    const sr=stage.getBoundingClientRect(), k=(sr.width/stage.offsetWidth)||1, r=el.getBoundingClientRect();
    return {x:(r.left-sr.left)/k, y:(r.top-sr.top)/k, w:r.width/k, h:r.height/k};
  }
  const sleep=(it,ms)=>new Promise(res=>setTimeout(()=>res(!it.dead),ms));

  // target: element, selector, or a {x,y,w,h} box in stage pixels. place: "below" | "above" | "right" | "left".
  // text (plain) or html (trusted, for bold words). Resolves once the note's text is on screen.
  async function show({target,text,html,place="below",gap=70,glow=true,pad=[10,16],maxW,align,round=false,lift=44,dx=0,box=false,margin=24,up=false,at=null,balance=false,straight=false}){
    const isBox=target&&typeof target==="object"&&target.w!==undefined&&!target.getBoundingClientRect;
    const el=isBox?null:(typeof target==="string"?document.querySelector(target):target); if(!el&&!isBox) return false;
    const it={dead:false,nodes:[]}; items.push(it);
    const r=isBox?target:rect(el), W=stage.offsetWidth, cx=r.x+r.w/2, cy=r.y+r.h/2, horiz=place==="right"||place==="left"||place==="auto";
    let gl=null;
    if(glow){ gl=document.createElement("div"); gl.className="an-glow"; if(round) gl.style.borderRadius="50%";
      gl.style.cssText+=`left:${r.x-pad[1]}px;top:${r.y-pad[0]}px;width:${r.w+2*pad[1]}px;height:${r.h+2*pad[0]}px`;
      under.appendChild(gl); it.nodes.push(gl); void gl.offsetWidth; gl.classList.add("on"); }
    const note=document.createElement("div"); note.className="an-note"+(box?" boxed":"");
    if(html) note.innerHTML=html; else note.textContent=text;
    if(maxW) note.style.maxWidth=maxW+"px"; if(align) note.style.textAlign=align; if(balance) note.style.textWrap="balance";   // balance: even line lengths, no lone last word
    layer.appendChild(note); it.nodes.push(note);
    if(horiz){                                            // pick the side with room, and make the note fit it: it must never sit on its target
      const roomR=W-margin-(r.x+r.w+gap), roomL=(r.x-gap)-margin, want=maxW||360;
      if(place==="auto") place=roomR>=roomL?"right":"left";
      else if(place==="right"&&roomR<Math.min(want,220)&&roomL>roomR) place="left";
      else if(place==="left"&&roomL<Math.min(want,220)&&roomR>roomL) place="right";
      note.style.maxWidth=Math.max(150,Math.min(want,place==="right"?roomR:roomL))+"px";
    }
    const nw=note.offsetWidth, nh=note.offsetHeight;
    let nx,ny,T,S,d;
    if(horiz){
      nx=place==="right"?r.x+r.w+gap:r.x-gap-nw;
      T=[place==="right"?r.x+r.w+(glow?pad[1]:0)+4:r.x-(glow?pad[1]:0)-4,cy];
      if(up){                                               // the note sits up and to the side; the arrow rises and points at the note's underside
        ny=Math.max(24,cy-Math.max(lift,40)-nh);
        S=[place==="right"?nx+34:nx+nw-34,ny+nh+12];
        d=`M${T[0]},${T[1]} C${T[0]+(S[0]-T[0])*.65},${T[1]} ${S[0]},${S[1]+(T[1]-S[1])*.55} ${S[0]},${S[1]}`;
      } else {
        const sy=cy-lift; ny=Math.max(24,sy-nh/2);
        S=[place==="right"?nx-12:nx+nw+12,Math.max(ny+12,sy)];
        const ddx=S[0]-T[0];                                // leaves the target level, then bows up into the note
        d=`M${T[0]},${T[1]} C${T[0]+ddx*.7},${T[1]} ${S[0]-ddx*.05},${T[1]+(S[1]-T[1])*.65} ${S[0]},${S[1]}`;
      }
    } else {
      nx=Math.max(24,Math.min(W-24-nw,cx-nw/2+dx)); ny=place==="above"?r.y-gap-nh:r.y+r.h+gap;
      if(at){ nx=at.x; ny=at.y; place=cy>ny+nh/2?"above":"below"; }
    }
    note.style.left=nx+"px"; note.style.top=ny+"px";
    if(!horiz){
      T=[cx,place==="above"?r.y-(glow?pad[0]:0)-4:r.y+r.h+(glow?pad[0]:0)+4]; const ex=at?Math.max(nx+24,Math.min(nx+nw-24,(cx+nx+nw/2)/2)):Math.max(nx+16,Math.min(nx+nw-16,cx));
      S=[ex,place==="above"?ny+nh+12:ny-12]; const m=(S[1]+T[1])/2;
      d=`M${T[0]},${T[1]} C${T[0]},${m} ${S[0]},${m} ${S[0]},${S[1]}`;
      if(straight){ S[0]=T[0]; d=`M${T[0]},${T[1]} L${S[0]},${S[1]}`; }   // a plain vertical arrow
    }
    const line=document.createElementNS(NS,"path"), head=document.createElementNS(NS,"path");
    line.setAttribute("class","an-line"); head.setAttribute("class","an-head");
    line.setAttribute("d",d);
    head.setAttribute("d","M-10,-7 L0,0 L-10,7");
    svg.appendChild(line); svg.appendChild(head); it.nodes.push(line,head);
    const len=line.getTotalLength?line.getTotalLength():300;
    line.style.strokeDasharray=len; line.style.strokeDashoffset=len;     // hidden from the start, so it is drawn once only
    if(!(await sleep(it,glow?900:0))) return false;
    let ang=place==="above"?-90:place==="right"?0:place==="left"?180:90;
    if(line.getPointAtLength){ const e=line.getPointAtLength(len), q=line.getPointAtLength(Math.max(0,len-6)); ang=Math.atan2(e.y-q.y,e.x-q.x)*180/Math.PI; }
    head.setAttribute("transform",`translate(${S[0]},${S[1]}) rotate(${ang})`);
    void line.getBoundingClientRect();
    line.style.transition="stroke-dashoffset .9s cubic-bezier(.4,0,.2,1)"; line.style.strokeDashoffset=0;
    head.style.transition="opacity .12s ease .78s"; head.style.opacity=1;      // the head appears as the line arrives
    if(!(await sleep(it,950))) return false;
    note.classList.add("on");
    return true;
  }

  // size a note would have, so callers can look for free space before showing it
  function measure(text,{maxW,box=false,align}={}){
    const n=document.createElement("div"); n.className="an-note"+(box?" boxed":""); n.style.visibility="hidden"; n.textContent=text;
    if(maxW) n.style.maxWidth=maxW+"px"; if(align) n.style.textAlign=align; layer.appendChild(n);
    const o={w:n.offsetWidth,h:n.offsetHeight}; n.remove(); return o;
  }

  // fade everything out (or remove it at once)
  function clear(now){
    const gone=items; items=[];
    gone.forEach(it=>{ it.dead=true;
      it.nodes.forEach(n=>{ if(now) n.remove(); else { n.classList.add("an-out"); setTimeout(()=>n.remove(),600); } }); });
  }
  window.Anno={show,clear,measure};
})();
