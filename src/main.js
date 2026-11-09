import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as Pose from './pose.js';
import { Sheet } from './sheet.js';
import { makePattern } from './fragmentation.js';
import { vert, vertSim, vertFlame, frag, fragF } from './shaders.js';

(function(){
  var stage=document.getElementById('stage');
  var renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});
  renderer.setPixelRatio(Math.min(devicePixelRatio,2));
  stage.appendChild(renderer.domElement);
  var canvas=renderer.domElement;
  var scene=new THREE.Scene();
  var camera=new THREE.PerspectiveCamera(38,1,0.1,50);
  var ZMIN=2.2, ZMAX=30, camZ=8.5, camZT=8.5; camera.position.set(0,0,camZ);
  var group=new THREE.Group(); scene.add(group);

  var uniforms={
    uMap:{value:null}, uGrab:{value:new THREE.Vector2()}, uPull:{value:new THREE.Vector3()},
    uRadius:{value:1.1}, uTime:{value:0}, uLightPos:{value:new THREE.Vector3(1.5,1.5,4)},
    uLight:{value:1.1}, uAmb:{value:0.3}, uGloss:{value:0.35}, uPix:{value:0}, uHalf:{value:0}, uFire:{value:0}, uFlat:{value:0}, uFacet:{value:null}, uCrease:{value:null}, uFacetK:{value:0}, uCreaseK:{value:0}, uFlame:{value:0.25}, uHSize:{value:0.4}, uWind:{value:0.5}, uSize:{value:new THREE.Vector2(3,4)}
  };
  var mat=new THREE.ShaderMaterial({uniforms:uniforms,vertexShader:vertSim,fragmentShader:frag,side:THREE.DoubleSide,extensions:{derivatives:true}});
  var poster=new THREE.Mesh(new THREE.PlaneGeometry(1,1),mat); group.add(poster);
  var flameMat=new THREE.ShaderMaterial({uniforms:uniforms,vertexShader:vertFlame,fragmentShader:fragF,transparent:true,blending:THREE.AdditiveBlending,depthWrite:false,side:THREE.DoubleSide});
  var flameMesh=new THREE.Mesh(new THREE.PlaneGeometry(1,1),flameMat); flameMesh.position.z=0; flameMesh.frustumCulled=false; flameMesh.renderOrder=2; flameMesh.raycast=function(){}; group.add(flameMesh);

  var W=3,H=4;

  // soft shadow on an imaginary wall
  var sc=document.createElement('canvas'); sc.width=sc.height=256;
  var sx=sc.getContext('2d'); sx.shadowColor='#000'; sx.shadowBlur=36; sx.shadowOffsetX=1000;
  sx.fillRect(-1000+40,40,176+40,176+40);
  var shTex=new THREE.CanvasTexture(sc);
  var shadow=new THREE.Mesh(new THREE.PlaneGeometry(1,1),new THREE.MeshBasicMaterial({map:shTex,transparent:true,opacity:.5,depthWrite:false}));
  shadow.position.z=-1.3; scene.add(shadow);

  // ---- pose.js (kaik): creases as fold matrices; used for the zigzag / accordion crumple ----
  // ---- paper simulation: position based dynamics, after kaik's paper.js ----
  // stretch + shear links keep it from stretching, multi-span bending keeps wide springy curves,
  // deep bends are remembered as creases, layers push apart so folds can't pass through themselves.
  var sheet=null;
  function makeSheet(W,H){var s=new Sheet(W,H); s.onSmooth=function(){folds=[];foldAnim=null;foldBtns();}; return s;}
  // a point of the flat poster (x,y local) → its place on the simulated sheet, lifted off it by off
  var _o=[0,0,0];
  function simPt(x,y,o,off){
    var S=sheet,W2=S.W/2,H2=S.H/2,cx=Math.max(-W2,Math.min(W2,x)),cy=Math.max(-H2,Math.min(H2,y));
    var fu=(cx+W2)/S.W*S.nx,fv=(H2-cy)/S.H*S.ny,k=Math.min(S.nx-1,Math.floor(fu)),j=Math.min(S.ny-1,Math.floor(fv)),a=fu-k,b=fv-j,X=S.nx+1,p=S.p;
    var i00=3*(j*X+k),i10=3*(j*X+k+1),i01=3*((j+1)*X+k),i11=3*((j+1)*X+k+1),P=[0,0,0],r=[0,0,0],u=[0,0,0],c;
    for(c=0;c<3;c++){
      P[c]=(p[i00+c]*(1-a)+p[i10+c]*a)*(1-b)+(p[i01+c]*(1-a)+p[i11+c]*a)*b;
      r[c]=p[i10+c]-p[i00+c]; u[c]=p[i00+c]-p[i01+c];
    }
    var rl=Math.hypot(r[0],r[1],r[2])||1,ul=Math.hypot(u[0],u[1],u[2])||1; for(c=0;c<3;c++){r[c]/=rl;u[c]/=ul;}
    var nx=r[1]*u[2]-r[2]*u[1],ny=r[2]*u[0]-r[0]*u[2],nz=r[0]*u[1]-r[1]*u[0],dx=x-cx,dy=y-cy;
    o.x=P[0]+r[0]*dx+u[0]*dy+nx*off; o.y=P[1]+r[1]*dx+u[1]*dy+ny*off; o.z=P[2]+r[2]*dx+u[2]*dy+nz*off;
  }
  function setFlameGeom(){
    var g=new THREE.PlaneGeometry(W*1.6,H*2,Math.round(W*12),Math.round(H*24)),ps=g.attributes.position,pl=new Float32Array(ps.count*2);
    for(var i=0;i<ps.count;i++){pl[2*i]=ps.getX(i);pl[2*i+1]=ps.getY(i);}
    g.setAttribute('plane',new THREE.BufferAttribute(pl,2)); g.userData.pl=pl;
    flameMesh.geometry.dispose(); flameMesh.geometry=g;
  }
  // ---- folding: the sheet is pulled to a stack of folded targets, each fold turns half the stack 180° about its crease ----
  var folds=[], foldAnim=null, FOLD_T=1.3, TH_F=Math.PI-0.03; // folds stop a little short of flat so the layers never press together
  function targetsFor(rec,th){
    var bs=rec.base,t=new Float32Array(bs.length),n=sheet.n,c=Math.cos(th),s=Math.sin(th),b=rec.b,i,k;
    var sc=Math.abs(th)<1e-4?1-th*th/6:s/th, cc=Math.abs(th)<1e-4?th/2:(1-c)/th;
    var offN=-b*c-b+2*b*sc, offZ=-b*s+2*b*cc;
    for(i=0;i<n;i++){k=3*i;var x=bs[k],y=bs[k+1],z=bs[k+2];
      t[k]=x;t[k+1]=y;t[k+2]=z;
      var d=(rec.axis?x:y)-rec.mid; if(d<-b) continue;
      var dz=z-rec.zc,na,nz;
      if(d<=b){ // inside the crease: bent over a smooth arc instead of a sharp kink
        var u=d+b,ph=th*u/(2*b),sp=Math.abs(ph)<1e-4?1-ph*ph/6:Math.sin(ph)/ph,cp=Math.abs(ph)<1e-4?ph/2:(1-Math.cos(ph))/ph;
        na=-b+u*sp-dz*Math.sin(ph); nz=u*cp+dz*Math.cos(ph);
      } else { na=d*c-dz*s+offN; nz=d*s+dz*c+offZ; }
      if(rec.axis) t[k]=rec.mid+na; else t[k+1]=rec.mid+na;
      t[k+2]=rec.zc+nz;
    }
    return t;
  }
  function foldBtns(){
    var f=document.getElementById('fold'),u=document.getElementById('unfold'); if(!f)return;
    f.textContent=folds.length?'Fold again ('+folds.length+')':'Fold in half'; f.disabled=folds.length>=7;
    u.disabled=!folds.length;
  }
  function startFold(){
    if(!sheet||shred||foldAnim||folds.length>=7||crumpleV>0.001||crumpleC>0.001) return;
    var S=sheet,n=S.n,i,base;
    if(folds.length) base=folds[folds.length-1].final;
    else{ base=new Float32Array(n*3); for(i=0;i<n;i++){base[3*i]=S.u[i]-S.W/2;base[3*i+1]=S.H/2-S.v[i];} }
    var axis=folds.length%2,mn=1e9,mx=-1e9,zmax=-1e9,zmin=1e9;
    for(i=0;i<n;i++){var a=axis?base[3*i]:base[3*i+1]; if(a<mn)mn=a; if(a>mx)mx=a; if(base[3*i+2]>zmax)zmax=base[3*i+2]; if(base[3*i+2]<zmin)zmin=base[3*i+2];}
    var mid=(mn+mx)/2, zs=[]; for(i=0;i<n;i++) zs.push(base[3*i+2]); zs.sort(function(p,q){return p-q;});
    var zlay=zs[Math.floor(0.97*(n-1))]; // the layers' top, not the rounded edges that stick out of earlier creases
    var rec={axis:axis,mid:mid,zc:zlay+0.5*S.R,b:0.3*S.s,base:base,final:null};
    rec.final=targetsFor(rec,TH_F);
    folds.push(rec); foldAnim={rec:rec,from:0,to:TH_F,t:0,pop:false}; S.tgtK=0.25; foldBtns();
  }
  function startUnfold(){
    if(!sheet||foldAnim||!folds.length) return;
    foldAnim={rec:folds[folds.length-1],from:TH_F,to:0,t:0,pop:true}; sheet.tgtK=0.25;
  }
  function updateFold(dt){
    var A=foldAnim; if(!A) return;
    A.t+=dt; var u=Math.min(1,A.t/FOLD_T), e=u*u*(3-2*u);
    sheet.tgt=targetsFor(A.rec,A.from+(A.to-A.from)*e);
    if(u>=1){
      if(A.pop){ folds.pop(); sheet.tgt=folds.length?folds[folds.length-1].final:null; }
      else sheet.tgt=A.rec.final;
      sheet.tgtK=0.12; foldAnim=null; foldBtns();
    }
  }


  // ---- crumple: sharp zigzag / accordion creases (angles grow with the slider), flat shaded like folded paper ----
  var crumpleV=0, crumpleC=0, crumpleLast=-1, crShape=null, crStyle=0, CR_STYLES=['Ball','Zigzag','Accordion','Fan'];
  function sstep(a,b,x){x=Math.max(0,Math.min(1,(x-a)/(b-a)));return x*x*(3-2*x);}
  function crumpleSeed(){
    var Wm=W*100,Hm=H*100,st=CR_STYLES[crStyle];
    if(st==='Ball'){ var rv=function(){return [Math.random()*50,Math.random()*50,Math.random()*50];}; crShape={creases:[],mods:{},ball:{o1:rv(),o2:rv(),s:Math.floor(Math.random()*1e6)}}; return; }
    if(st==='Zigzag'){
      var cs=Pose.zigzag(Pose.randomCreases(Wm,Hm,4+Math.floor(Math.random()*6),Math.random,38,function(){return 100+Math.random()*55;}),Hm,Math.random()<0.5?1:-1);
      crShape={creases:cs,mods:{twist:(Math.random()-0.5)*0.25}};
    } else crShape=Pose.presetShape(st.toLowerCase(),Wm,Hm,Math.random);
  }
  // ---- ball crumple: the sheet wraps onto a sphere (arc length kept, so it really shrinks) and the wad gets sharp ridged creases and lumps ----
  function hash3(i,j,k,s){var h=Math.imul(i,374761393)^Math.imul(j,668265263)^Math.imul(k,1442695041)^Math.imul(s,1274126177); h=Math.imul(h^(h>>>13),1274126177); return ((h^(h>>>16))>>>0)/4294967295;}
  function mixN(a,b,t){return a+(b-a)*t;}
  function vnoise(x,y,z,s){
    var i=Math.floor(x),j=Math.floor(y),k=Math.floor(z),a=x-i,b=y-j,d=z-k; a=a*a*(3-2*a); b=b*b*(3-2*b); d=d*d*(3-2*d);
    return mixN(mixN(mixN(hash3(i,j,k,s),hash3(i+1,j,k,s),a),mixN(hash3(i,j+1,k,s),hash3(i+1,j+1,k,s),a),b),
              mixN(mixN(hash3(i,j,k+1,s),hash3(i+1,j,k+1,s),a),mixN(hash3(i,j+1,k+1,s),hash3(i+1,j+1,k+1,s),a),b),d);
  }
  function rdg(x,y,z,s){return 1-Math.abs(2*vnoise(x,y,z,s)-1);} // ridged noise = sharp crease lines
  function ballPose(S,c,b){
    var t=new Float32Array(S.n*3), W2=S.W/2, H2=S.H/2, rmax=Math.hypot(W2,H2), k=1-0.35*sstep(0,1,c),
        th=Math.max(0.02,Math.PI*0.96*c), Rc=rmax*k/th, A=0.3*sstep(0.05,0.8,c), z0=Math.cos(th/2), i;
    for(i=0;i<S.n;i++){
      var x=S.u[i]-W2, y=H2-S.v[i], phi=Math.atan2(y,x), a=Math.hypot(x,y)*k/Rc, sa=Math.sin(a), dx=sa*Math.cos(phi), dy=sa*Math.sin(phi), dz=Math.cos(a);
      var bump=0.65*(rdg(dx*1.7+b.o1[0],dy*1.7+b.o1[1],dz*1.7+b.o1[2],b.s)-0.5)+0.35*(rdg(dx*3.9+b.o2[0],dy*3.9+b.o2[1],dz*3.9+b.o2[2],b.s+7)-0.5);
      var R=Rc*(1+2*A*bump);
      t[3*i]=R*dx; t[3*i+1]=R*dy; t[3*i+2]=R*(dz-z0);
    }
    return t;
  }
  // ---- facets from the fragmentation model (Andrejevic et al. 2021): the wad is flat facets split by ridges, and every crumple leaves creases that stay ----
  var FW=192, FH=256, fragN=0, fragPat=null, fragLast=null, fragLevel=-1, fragPeak=0, fragSeed=1, creaseR=null, facetTex=null, creaseTex=null, FRAG_MAX=500;
  function fragReset(){
    FH=Math.max(32,Math.round(FW*H/W)); fragN=0; fragPat=null; fragLast=null; fragLevel=-1; fragPeak=0; fragSeed=(Math.random()*1e9)|0; creaseR=new Uint8Array(FW*FH);
    if(facetTex) facetTex.dispose(); if(creaseTex) creaseTex.dispose();
    facetTex=new THREE.DataTexture(new Uint8Array(FW*FH*4).fill(128),FW,FH,THREE.RGBAFormat); facetTex.minFilter=facetTex.magFilter=THREE.LinearFilter; facetTex.needsUpdate=true;
    creaseTex=new THREE.DataTexture(new Uint8Array(FW*FH*4),FW,FH,THREE.RGBAFormat); creaseTex.minFilter=creaseTex.magFilter=THREE.LinearFilter; creaseTex.needsUpdate=true;
    uniforms.uFacet.value=facetTex; uniforms.uCrease.value=creaseTex; uniforms.uFacetK.value=0; uniforms.uCreaseK.value=0;
  }
  function fragUpdate(c){ // compaction D = 1 - 0.955 c (the paper's range 0.045..1); crumple number n = crumples so far + 1
    var q=Math.max(1,Math.min(6,Math.round(c*6)));
    if(c>fragPeak) fragPeak=c;
    uniforms.uFacetK.value=sstep(0.04,0.3,c);
    if(q!==fragLevel){ fragLevel=q; fragPat=makePattern(fragN+1,1-0.955*q/6,FW,FH,fragSeed+q*97,FRAG_MAX); facetTex.image.data.set(fragPat.data); facetTex.needsUpdate=true; fragLast=fragPat; }
  }
  function fragCommit(){ // let go: the paper opens, but the ridges stay as creases (damage accumulates with every crumple)
    var i,r=fragLast&&fragLast.ridge,d=creaseTex.image.data;
    if(r){ for(i=0;i<creaseR.length;i++){ creaseR[i]=Math.min(255,creaseR[i]+r[i]*150); d[4*i]=creaseR[i]; } creaseTex.needsUpdate=true; uniforms.uCreaseK.value=1; }
    fragN++; fragPeak=0; fragLevel=-1;
  }
  function updateCrumple(){
    var S=sheet; if(!S||folds.length||foldAnim) return;
    crumpleC+=(crumpleV-crumpleC)*0.12; if(Math.abs(crumpleV-crumpleC)<0.002) crumpleC=crumpleV;
    var c=crumpleC;
    if(c<0.04&&fragPeak>0.35) fragCommit();
    if(c<0.001){ if(S.crumpling){S.pose=null;S.crumpling=false;uniforms.uFlat.value=0;} crShape=null; crumpleLast=-1; return; }
    if(!crShape) crumpleSeed();
    if(S.crumpling&&Math.abs(c-crumpleLast)<1e-4) return;
    crumpleLast=c;
    if(CR_STYLES[crStyle]==='Ball'){ fragUpdate(c); S.pose=ballPose(S,c,crShape.ball); S.crumpling=true; uniforms.uFlat.value=0.8*sstep(0.08,0.5,c); return; }
    var cs=crShape.creases.map(function(k){var o={};for(var q in k)o[q]=k[q];o.angle=k.angle*c;return o;});
    var fn=Pose.makePose(W*100,H*100,cs,{twist:(crShape.mods.twist||0)*c}),o=[0,0,0],t=new Float32Array(S.n*3),i;
    for(i=0;i<S.n;i++){fn(S.u[i]*100,S.v[i]*100,o);t[3*i]=o[0]*0.01;t[3*i+1]=o[1]*0.01;t[3*i+2]=o[2]*0.01;}
    S.pose=t; S.crumpling=true; uniforms.uFlat.value=0.75*sstep(0.1,0.6,c);
  }
  var _po={x:0,y:0,z:0};
  function stepSheet(dt){
    var S=sheet; if(!S) return;
    updateFold(dt);
    updateCrumple();
    S.step(Math.min(dt,1/30),uniforms.uWind.value,uniforms.uTime.value);
    S.normals(S.p);
    var g=poster.geometry, pos=g.attributes.position.array, nm=g.attributes.normal.array, i;
    pos.set(S.p); for(i=0;i<nm.length;i++) nm[i]=-S.nq[i];
    g.attributes.position.needsUpdate=true; g.attributes.normal.needsUpdate=true; g.computeBoundingSphere();
    if(uniforms.uFire.value>0.005&&flameMesh.visible){
      var fg=flameMesh.geometry,pl=fg.userData.pl,fp=fg.attributes.position.array;
      for(i=0;i<pl.length/2;i++){simPt(pl[2*i],pl[2*i+1],_po,0.04);fp[3*i]=_po.x;fp[3*i+1]=_po.y;fp[3*i+2]=_po.z;}
      fg.attributes.position.needsUpdate=true; fg.boundingSphere=null;
    }
  }

  // ---- ripping: a grabbed piece tears off along a random ragged edge and falls to the floor ----
  // the poster keeps a per-pixel "still there" mask (uRip); torn pixels are discarded in the shader, so edges are ragged at pixel level
  var ripOn=false, ripT=0.35, ripMW=2, ripMH=2, ripPresent=null, ripTex=null, ripTexS=null, ripDataA=null, ripDataB=null, ripCv=null, scraps=[], scrapN=0, ripScrap=null, RIP_MAX=40, RIP_LIE=-1.05;
  var ripWhite=new THREE.DataTexture(new Uint8Array([255,255,255,255]),1,1,THREE.RGBAFormat); ripWhite.needsUpdate=true;
  uniforms.uRip={value:ripWhite}; uniforms.uRipS={value:ripWhite}; uniforms.uAO={value:1};
  var _ripX=new THREE.Vector3(1,0,0), _rq=new THREE.Quaternion(), _rq2=new THREE.Quaternion(), _rE=new THREE.Euler(), _ripZ=new THREE.Vector3(0,0,1), _ripY=new THREE.Vector3(0,1,0), _rv=new THREE.Vector3(), _rpt={x:0,y:0,z:0};
  function ripRadius(){ return 0.1+1.5*ripT*ripT; } // world units: small slider = small scrap, large = big chunk
  function lumTex(data,w,h){ var t=new THREE.DataTexture(data,w,h,THREE.LuminanceFormat,THREE.UnsignedByteType); t.minFilter=t.magFilter=THREE.LinearFilter; t.generateMipmaps=false; t.unpackAlignment=1; t.needsUpdate=true; return t; }
  // box blur of one rectangle of a 0/255 mask (repeated passes ~ a gaussian); only the changed area is redone
  function blurRegion(src,w,h,rx0,ry0,rx1,ry1,r,passes,dst){
    var E=r*passes,wx0=Math.max(0,rx0-E),wy0=Math.max(0,ry0-E),wx1=Math.min(w-1,rx1+E),wy1=Math.min(h-1,ry1+E),ww=wx1-wx0+1,wh=wy1-wy0+1;
    var a=new Float32Array(ww*wh),b=new Float32Array(ww*wh),inv=1/(2*r+1),x,y,k,s,p,row;
    for(y=0;y<wh;y++)for(x=0;x<ww;x++)a[y*ww+x]=src[(y+wy0)*w+x+wx0]/255;
    for(p=0;p<passes;p++){
      for(y=0;y<wh;y++){ row=y*ww; s=0; for(k=-r;k<=r;k++) s+=a[row+Math.min(ww-1,Math.max(0,k))];
        for(x=0;x<ww;x++){ b[row+x]=s*inv; s+=a[row+Math.min(ww-1,x+r+1)]-a[row+Math.max(0,x-r)]; } }
      for(x=0;x<ww;x++){ s=0; for(k=-r;k<=r;k++) s+=b[Math.min(wh-1,Math.max(0,k))*ww+x];
        for(y=0;y<wh;y++){ a[y*ww+x]=s*inv; s+=b[Math.min(wh-1,y+r+1)*ww+x]-b[Math.max(0,y-r)*ww+x]; } }
    }
    for(y=ry0;y<=ry1;y++)for(x=rx0;x<=rx1;x++)dst[y*w+x]=Math.round(a[(y-wy0)*ww+(x-wx0)]*255);
  }
  var RIP_P1=5, RIP_P2=34; // how far the sharp (r2) and soft (r11) blurs reach past a changed area
  function ripBlurBoth(src,bx0,by0,bx1,by1,dA,dB){
    blurRegion(src,ripMW,ripMH,Math.max(0,bx0-RIP_P1),Math.max(0,by0-RIP_P1),Math.min(ripMW-1,bx1+RIP_P1),Math.min(ripMH-1,by1+RIP_P1),2,2,dA);
    blurRegion(src,ripMW,ripMH,Math.max(0,bx0-RIP_P2),Math.max(0,by0-RIP_P2),Math.min(ripMW-1,bx1+RIP_P2),Math.min(ripMH-1,by1+RIP_P2),11,3,dB);
  }
  function ripClearScraps(){
    scraps.forEach(function(sc){ scene.remove(sc.mesh); sc.geo.dispose(); sc.mat.dispose(); sc.tex.dispose(); sc.texS.dispose(); });
    scraps=[]; scrapN=0; ripScrap=null;
  }
  function ripResetMask(){ // new poster size → fresh, whole paper
    ripClearScraps();
    var m=768; ripMW=W>=H?m:Math.max(8,Math.round(m*W/H)); ripMH=W>=H?Math.max(8,Math.round(m*H/W)):m;
    var n=ripMW*ripMH;
    ripPresent=new Uint8Array(n).fill(255); ripDataA=new Uint8Array(n).fill(255); ripDataB=new Uint8Array(n).fill(255);
    if(ripTex&&uniforms.uRip.value===ripTex){ ripTex.dispose(); ripTexS.dispose(); }
    ripTex=lumTex(ripDataA,ripMW,ripMH); ripTexS=lumTex(ripDataB,ripMW,ripMH); uniforms.uRip.value=ripTex; uniforms.uRipS.value=ripTexS;
    ripCv=document.createElement('canvas'); ripCv.width=ripMW; ripCv.height=ripMH;
  }
  function ripRestore(){
    fragReset(); if(!ripPresent) return; ripClearScraps(); ripPresent.fill(255); ripDataA.fill(255); ripDataB.fill(255); ripTex.needsUpdate=true; ripTexS.needsUpdate=true;
  }
  function ripTorn(uv){ // is this spot of the poster already gone (torn off or burnt away)?
    if(!uv) return false;
    if(bB&&bB[Math.min(BH-1,Math.max(0,Math.floor(uv.y*BH)))*BW+Math.min(BW-1,Math.max(0,Math.floor(uv.x*BW)))]>=0.95) return true;
    if(!ripPresent) return false;
    var x=Math.min(ripMW-1,Math.max(0,Math.floor(uv.x*ripMW))),y=Math.min(ripMH-1,Math.max(0,Math.floor(uv.y*ripMH)));
    return ripPresent[y*ripMW+x]===0;
  }
  // a random torn outline: a lumpy blob whose edge is broken up again and again at finer and finer scales, like paper pulled apart
  function ripShape(cx,cy,R){
    var M=9+Math.floor(Math.random()*6),pts=[],asp=0.55+0.45*Math.random(),rot=Math.random()*6.283,ox=(Math.random()-0.5)*0.3*R,oy=(Math.random()-0.5)*0.3*R,i,a,it;
    var cr=Math.cos(rot),sr=Math.sin(rot),amp=[0.62,0.58,0.52,0.46,0.4,0.34];
    for(i=0;i<M;i++){ a=(i+Math.random()*0.7)/M*6.283; var r=R*(0.6+0.55*Math.random()),x=Math.cos(a)*r,y=Math.sin(a)*r*asp;
      pts.push([cx+ox+x*cr-y*sr,cy+oy+x*sr+y*cr]); }
    for(it=0;it<amp.length;it++){ var nx=[];
      for(i=0;i<pts.length;i++){ var p=pts[i],q=pts[(i+1)%pts.length],dx=q[0]-p[0],dy=q[1]-p[1],len=Math.hypot(dx,dy)||1,d=(Math.random()-0.5)*len*amp[it];
        nx.push(p,[(p[0]+q[0])/2-dy/len*d,(p[1]+q[1])/2+dx/len*d]); }
      pts=nx; }
    var c=ripCv.getContext('2d'); c.fillStyle='#000'; c.fillRect(0,0,ripMW,ripMH); c.fillStyle='#fff'; c.beginPath();
    for(i=0;i<pts.length;i++){ if(i)c.lineTo(pts[i][0],ripMH-pts[i][1]); else c.moveTo(pts[i][0],ripMH-pts[i][1]); }
    c.closePath(); c.fill();
    var d=c.getImageData(0,0,ripMW,ripMH).data,bin=new Uint8Array(ripMW*ripMH),x2,y2;
    for(y2=0;y2<ripMH;y2++)for(x2=0;x2<ripMW;x2++) if(d[((ripMH-1-y2)*ripMW+x2)*4]>127) bin[y2*ripMW+x2]=255;
    return bin;
  }
  // tear a piece off the paper where it was grabbed; returns the loose scrap (or null if nothing came away)
  function doRip(uv,shapeOv){
    var S=sheet; if(!S||!ripPresent) return null;
    var Rpx=ripRadius()*ripMW/W, shape=shapeOv||ripShape(uv.x*ripMW,uv.y*ripMH,Rpx), n=ripMW*ripMH, bin=new Uint8Array(n), cnt=0, sxs=0, sys=0, i, x, y, bx0=ripMW, bx1=-1, by0=ripMH, by1=-1;
    for(y=0;y<ripMH;y++)for(x=0;x<ripMW;x++){ i=y*ripMW+x; if(shape[i]&&ripPresent[i]){ bin[i]=255; cnt++; sxs+=x; sys+=y; if(x<bx0)bx0=x; if(x>bx1)bx1=x; if(y<by0)by0=y; if(y>by1)by1=y; } }
    if(cnt<40) return null;
    for(i=0;i<n;i++) if(bin[i]) ripPresent[i]=0;
    ripBlurBoth(ripPresent,bx0,by0,bx1,by1,ripDataA,ripDataB); ripTex.needsUpdate=true; ripTexS.needsUpdate=true;
    // the grid cells the piece covers become the scrap's mesh (taken from the paper exactly as it is bent right now)
    var nx=S.nx,ny=S.ny,X=nx+1,use=new Int32Array(X*(ny+1)).fill(-1),vs=[],idx=[],k,j,ax,ay,hit,c4;
    for(j=0;j<ny;j++)for(k=0;k<nx;k++){
      var x0=Math.floor(k/nx*ripMW),x1=Math.min(ripMW-1,Math.ceil((k+1)/nx*ripMW)),y0=Math.floor((1-(j+1)/ny)*ripMH),y1=Math.min(ripMH-1,Math.ceil((1-j/ny)*ripMH));
      hit=false;
      for(ay=y0;ay<=y1&&!hit;ay+=2)for(ax=x0;ax<=x1;ax+=2) if(bin[ay*ripMW+ax]){ hit=true; break; }
      if(!hit) continue;
      c4=[j*X+k,j*X+k+1,(j+1)*X+k,(j+1)*X+k+1];
      for(i=0;i<4;i++) if(use[c4[i]]<0){ use[c4[i]]=vs.length; vs.push(c4[i]); }
      idx.push(use[c4[0]],use[c4[2]],use[c4[1]],use[c4[2]],use[c4[3]],use[c4[1]]);
    }
    if(!vs.length) return null;
    var W2=W/2,H2=H/2,cxf=(sxs/cnt/ripMW)*W-W2,cyf=(sys/cnt/ripMH)*H-H2;
    simPt(cxf,cyf,_rpt,0); var cx=_rpt.x,cy=_rpt.y,cz=_rpt.z; // the piece's own centre
    var m=vs.length,pos=new Float32Array(m*3),flat=new Float32Array(m*3),nm=new Float32Array(m*3),uvs=new Float32Array(m*2),pu=poster.geometry.attributes.uv.array,v0;
    for(i=0;i<m;i++){ v0=vs[i];
      pos[3*i]=S.p[3*v0]-cx; pos[3*i+1]=S.p[3*v0+1]-cy; pos[3*i+2]=S.p[3*v0+2]-cz;
      flat[3*i]=S.u[v0]-W2-cxf; flat[3*i+1]=H2-S.v[v0]-cyf; flat[3*i+2]=0; // the same piece as it lies once it is let go
      nm[3*i]=-S.nq[3*v0]; nm[3*i+1]=-S.nq[3*v0+1]; nm[3*i+2]=-S.nq[3*v0+2];
      uvs[2*i]=pu[2*v0]; uvs[2*i+1]=pu[2*v0+1]; }
    var geo=new THREE.BufferGeometry(); geo.setAttribute('position',new THREE.BufferAttribute(pos,3)); geo.setAttribute('normal',new THREE.BufferAttribute(nm,3)); geo.setAttribute('uv',new THREE.BufferAttribute(uvs,2)); geo.setIndex(idx);
    var dA=new Uint8Array(n),dB=new Uint8Array(n); ripBlurBoth(bin,bx0,by0,bx1,by1,dA,dB);
    var texA=lumTex(dA,ripMW,ripMH),texB=lumTex(dB,ripMW,ripMH),su=Object.assign({},uniforms); su.uRip={value:texA}; su.uRipS={value:texB}; su.uAO={value:0};
    var mat2=new THREE.ShaderMaterial({uniforms:su,vertexShader:vertSim,fragmentShader:frag,side:THREE.DoubleSide,extensions:{derivatives:true}});
    var mesh=new THREE.Mesh(geo,mat2); mesh.frustumCulled=false; scene.add(mesh);
    // the edge of the scrap, used for the floor contact: on the bent sheet now, and flat once it has relaxed
    var edge=[]; for(y=0;y<ripMH;y++)for(x=0;x<ripMW;x++){ i=y*ripMW+x; if(!bin[i]) continue;
      if(x===0||y===0||x===ripMW-1||y===ripMH-1||!bin[i-1]||!bin[i+1]||!bin[i-ripMW]||!bin[i+ripMW]) edge.push(x,y); }
    var step=Math.max(1,Math.ceil(edge.length/2/320)),ptsB=[],ptsF=[],ex,ey;
    group.updateMatrixWorld(true);
    var qB=group.getWorldQuaternion(new THREE.Quaternion());
    for(i=0;i<edge.length/2;i+=step){ ex=((edge[2*i]+0.5)/ripMW)*W-W2; ey=((edge[2*i+1]+0.5)/ripMH)*H-H2;
      simPt(ex,ey,_rpt,0); ptsB.push(_rpt.x-cx,_rpt.y-cy,_rpt.z-cz); ptsF.push(ex-cxf,ey-cyf,0); }
    var wp=group.localToWorld(new THREE.Vector3(cx,cy,cz)); mesh.position.copy(wp); mesh.quaternion.copy(qB);
    var qF=new THREE.Quaternion(); if(_rv.copy(_ripZ).applyQuaternion(qB).z<0) qF.setFromAxisAngle(_ripY,Math.PI);
    var sc={mesh:mesh,geo:geo,mat:mat2,vs:vs,use:use,gX:X,tri:idx,bin:bin,bb:[bx0,by0,bx1,by1],tex:texA,texS:texB,posArr:pos,bent:pos.slice(),flat:flat,ptsB:new Float32Array(ptsB),ptsF:new Float32Array(ptsF),pts:new Float32Array(ptsB),
      qBase:qB.clone(),qFace:qF,qLie:new THREE.Quaternion().setFromAxisAngle(_ripX,RIP_LIE),th:0,vx:0,vy:0,om:0,age:0,relax:0,ph:Math.random()*6.283,
      held:true,asleep:false,still:0,floorT:0,contact:false,lastT:performance.now(),start:wp.clone(),zHeld:Math.max(0,wp.z)+0.35,zRest:0.14+0.012*(scrapN++)};
    scraps.push(sc);
    if(scraps.length>RIP_MAX){ var old=scraps.shift(); scene.remove(old.mesh); old.geo.dispose(); old.mat.dispose(); old.tex.dispose(); old.texS.dispose(); if(ripScrap===old)ripScrap=null; }
    return sc;
  }
  // once let go the scrap stops being bent like the sheet it came from and lies flat
  function relaxScrap(sc){
    var e=sc.relax*sc.relax*(3-2*sc.relax),a=sc.posArr,b=sc.bent,f=sc.flat,i;
    for(i=0;i<a.length;i++) a[i]=b[i]+(f[i]-b[i])*e;
    sc.geo.attributes.position.needsUpdate=true; sc.geo.computeVertexNormals();
    var pb=sc.ptsB,pf=sc.ptsF,pp=sc.pts; for(i=0;i<pp.length;i++) pp[i]=pb[i]+(pf[i]-pb[i])*e;
  }
  // ---- flexible torn paper: once let go, a scrap becomes a small cloth (stretch links + soft bending that remembers its curl),
  // it falls with air drag on its broad side (so it flutters), drapes onto a visible sloped floor and rests there ----
  function scrapToCloth(sc){
    var m=sc.mesh,a=sc.posArr,n=a.length/3,i,t,e,p,q,v=new THREE.Vector3(),vs=sc.vs,use=sc.use,X=sc.gX,fl=sc.flat,bt=sc.bent,T=sc.tri;
    var P=new Float32Array(n*3); for(i=0;i<n;i++){ v.set(a[3*i],a[3*i+1],a[3*i+2]).applyQuaternion(m.quaternion).add(m.position); P[3*i]=v.x; P[3*i+1]=v.y; P[3*i+2]=v.z; }
    var rb=1e-6; for(i=0;i<n;i++) rb=Math.max(rb,Math.hypot(fl[3*i],fl[3*i+1]));
    var an=Math.random()*6.283,ax=Math.cos(an),ay=Math.sin(an),ck=(Math.random()<0.5?-1:1)*0.3/rb,cu=new Float32Array(n*3),pr; // a random cup: torn edges curl up
    for(i=0;i<n;i++){ pr=fl[3*i]*ax+fl[3*i+1]*ay; cu[3*i]=bt[3*i]; cu[3*i+1]=bt[3*i+1]; cu[3*i+2]=bt[3*i+2]+ck*pr*pr; }
    var dist=function(r,x,y){return Math.hypot(r[3*x]-r[3*y],r[3*x+1]-r[3*y+1],r[3*x+2]-r[3*y+2]);}, key=function(x,y){return x<y?x*n+y:y*n+x;};
    var ed=[],er=[],bd=[],br=[],seen=new Set(),kk;
    for(t=0;t<T.length;t+=3) for(e=0;e<3;e++){ p=T[t+e]; q=T[t+(e+1)%3]; kk=key(p,q); if(seen.has(kk)) continue; seen.add(kk); ed.push(p,q); er.push(dist(fl,p,q)); }
    [[1,0],[0,1]].forEach(function(d){ for(var i2=0;i2<n;i2++){
      var g=vs[i2],k=g%X,j=(g/X)|0,k2=k+2*d[0],j2=j+2*d[1]; if(k2>=X) continue;
      var g1=(j+d[1])*X+k+d[0],g2=j2*X+k2; if(g1>=use.length||g2>=use.length) continue;
      var mi=use[g1],q2=use[g2]; if(mi<0||q2<0||!seen.has(key(i2,mi))||!seen.has(key(mi,q2))) continue;
      bd.push(i2,q2); br.push(dist(cu,i2,q2)); } });
    var Q=P.slice(),vx=sc.vx/120,vy=sc.vy/120,om=sc.om/120,cx=m.position.x,cy=m.position.y;
    for(i=0;i<n;i++){ Q[3*i]-=vx-om*(P[3*i+1]-cy); Q[3*i+1]-=vy+om*(P[3*i]-cx); }
    sc.cp=P; sc.cq=Q; sc.ed=new Int32Array(ed); sc.er=new Float32Array(er); sc.bd=new Int32Array(bd); sc.br=new Float32Array(br); sc.nn=new Float32Array(n*3);
    sc.cloth=true; sc.relax=1; m.position.set(0,0,0); m.quaternion.identity(); a.set(P); sc.geo.attributes.position.needsUpdate=true;
  }
  function stepCloth(sc,dt,cz,tH,asp){
    if(sc.asleep){ if(Math.abs(cz-sc.camZ)<0.02&&Math.abs(asp-sc.asp)<0.01) return; sc.asleep=false; sc.still=0; }
    var P=sc.cp,Q=sc.cq,N=sc.nn,E=sc.ed,ER=sc.er,B=sc.bd,BR=sc.br,T=sc.tri,n=P.length/3,sub=2,h=dt/sub,s,it,i,t,c,k,a,b,d,x,y,z,dx,dy,dz,L,f;
    var y0=-0.82*cz*tH,sl=0.4,nl=1/Math.sqrt(1+sl*sl),fy=nl,fz=-sl*nl,touch=0,spd=0,TH=0.012; // floor: rises toward the camera so a paper lying on it can be seen
    sc.age+=dt;
    for(s=0;s<sub;s++){
      N.fill(0);
      for(t=0;t<T.length;t+=3){ a=3*T[t]; b=3*T[t+1]; d=3*T[t+2];
        var ux=P[b]-P[a],uy=P[b+1]-P[a+1],uz=P[b+2]-P[a+2],wx=P[d]-P[a],wy=P[d+1]-P[a+1],wz=P[d+2]-P[a+2],nx=uy*wz-uz*wy,ny=uz*wx-ux*wz,nz=ux*wy-uy*wx;
        for(c=0;c<3;c++){ k=3*T[t+c]; N[k]+=nx; N[k+1]+=ny; N[k+2]+=nz; } }
      for(i=0;i<n;i++){ k=3*i; L=Math.hypot(N[k],N[k+1],N[k+2])||1; var qx=N[k]/L,qy=N[k+1]/L,qz=N[k+2]/L;
        x=(P[k]-Q[k])*0.996; y=(P[k+1]-Q[k+1])*0.996; z=(P[k+2]-Q[k+2])*0.996;
        var vn=(x*qx+y*qy+z*qz)*0.2; x-=qx*vn; y-=qy*vn; z-=qz*vn; // the air resists a sheet moving broadside far more than edge-on
        L=Math.hypot(x,y,z); if(L>0.1){ f=0.1/L; x*=f; y*=f; z*=f; }
        Q[k]=P[k]; Q[k+1]=P[k+1]; Q[k+2]=P[k+2]; P[k]+=x; P[k+1]+=y-11*h*h; P[k+2]+=z; }
      for(it=0;it<4;it++){
        for(c=0;c<ER.length;c++){ a=3*E[2*c]; b=3*E[2*c+1]; dx=P[b]-P[a]; dy=P[b+1]-P[a+1]; dz=P[b+2]-P[a+2]; L=Math.hypot(dx,dy,dz); if(L<1e-9) continue; f=(L-ER[c])/L*0.5;
          P[a]+=dx*f; P[a+1]+=dy*f; P[a+2]+=dz*f; P[b]-=dx*f; P[b+1]-=dy*f; P[b+2]-=dz*f; }
        for(c=0;c<BR.length;c++){ a=3*B[2*c]; b=3*B[2*c+1]; dx=P[b]-P[a]; dy=P[b+1]-P[a+1]; dz=P[b+2]-P[a+2]; L=Math.hypot(dx,dy,dz); if(L<1e-9) continue; f=(L-BR[c])/L*0.5*0.3;
          P[a]+=dx*f; P[a+1]+=dy*f; P[a+2]+=dz*f; P[b]-=dx*f; P[b+1]-=dy*f; P[b+2]-=dz*f; }
        for(i=0;i<n;i++){ k=3*i; d=fy*(P[k+1]-y0)+fz*P[k+2]; if(d<TH){ P[k+1]+=fy*(TH-d); P[k+2]+=fz*(TH-d); }
          var lim=(cz-P[k+2])*tH*asp-0.05; if(P[k]>lim){P[k]=lim;Q[k]=lim;} else if(P[k]<-lim){P[k]=-lim;Q[k]=-lim;} }
      }
      for(i=0;i<n;i++){ k=3*i; d=fy*(P[k+1]-y0)+fz*P[k+2]; if(d>TH+0.01) continue; touch++; // friction and no bounce on the floor
        x=P[k]-Q[k]; y=P[k+1]-Q[k+1]; z=P[k+2]-Q[k+2]; var vv=y*fy+z*fz; if(vv<0){ y-=vv*fy; z-=vv*fz; } x*=0.45; y*=0.45; z*=0.45; Q[k]=P[k]-x; Q[k+1]=P[k+1]-y; Q[k+2]=P[k+2]-z; }
    }
    var zc=0; for(i=0;i<n;i++){ zc+=P[3*i+2]; spd+=Math.abs(P[3*i]-Q[3*i])+Math.abs(P[3*i+1]-Q[3*i+1])+Math.abs(P[3*i+2]-Q[3*i+2]); } zc/=n; spd/=n;
    if(touch<n*0.05){ var dzs=(sc.zRest-zc)*Math.min(1,dt*1.5); for(i=0;i<n;i++){ P[3*i+2]+=dzs; Q[3*i+2]+=dzs; } } // while in the air, drift to its own depth layer so pieces don't overlap
    sc.posArr.set(P); sc.geo.attributes.position.needsUpdate=true; sc.geo.computeVertexNormals();
    if(touch>n*0.1&&spd<0.0012){ sc.still+=dt; if(sc.still>0.6){ sc.asleep=true; sc.camZ=cz; sc.asp=asp; } } else sc.still=0;
  }
  // loose scraps: they flutter down, tip over to lie on the floor (the bottom edge of the canvas), and rest there
  function stepScraps(dt){
    if(!scraps.length) return;
    var tH=tanHalf,cz=camera.position.z,asp=camera.aspect,sub=2,h=dt/sub,si,i,p,sc,m;
    for(si=0;si<scraps.length;si++){
      sc=scraps[si]; m=sc.mesh;
      if(sc.ret){ m.position.lerp(sc.start,Math.min(1,dt*9)); sc.qBase.slerp(sc.qHome,Math.min(1,dt*9)); m.quaternion.copy(sc.qBase); if(m.position.distanceTo(sc.start)<0.03){ scrapMerge(sc); si--; } continue; }
      if(sc.held){
        m.position.z+=(sc.zHeld-m.position.z)*Math.min(1,dt*8);
        sc.qBase.slerp(sc.qFace,Math.min(1,dt*2)); m.quaternion.copy(sc.qBase).multiply(_rq.setFromAxisAngle(_ripZ,sc.th));
        continue;
      }
      if(sc.cloth){ stepCloth(sc,dt,cz,tH,asp); continue; }
      if(sc.asleep){ // zooming or resizing moves the bottom edge, so a resting scrap has to find the floor again
        if(Math.abs(cz-sc.camZ)>0.02||Math.abs(asp-sc.asp)>0.01){ sc.asleep=false; sc.still=0; sc.floorT=0; } else continue;
      }
      sc.age+=dt;
      if(sc.relax<1){ sc.relax=Math.min(1,sc.relax+dt/0.8); relaxScrap(sc); }
      for(p=0;p<sub;p++){
        var air=sc.contact?0:1;
        sc.vy-=11*h; if(sc.vy<-4.5) sc.vy+=(-4.5-sc.vy)*Math.min(1,h*10); // paper is slowed by the air
        sc.vx*=Math.exp(-(air?0.6:7)*h); sc.vx+=air*Math.sin(sc.age*3.1+sc.ph)*1.3*h;
        m.position.x+=sc.vx*h; m.position.y+=sc.vy*h; sc.th+=sc.om*h; sc.om*=Math.exp(-(air?0.7:8)*h);
        m.position.z+=(sc.zRest-m.position.z)*Math.min(1,h*5);
        sc.qBase.slerp(sc.qLie,Math.min(1,h*(air?1.6:12)));
        _rE.set(0.14*air*Math.sin(sc.age*4.3+sc.ph),0.14*air*Math.sin(sc.age*3.7+sc.ph*1.7),0); _rq2.setFromEuler(_rE);
        m.quaternion.copy(sc.qBase).multiply(_rq2).multiply(_rq.setFromAxisAngle(_ripZ,sc.th));
        sc.contact=false;
        var pts=sc.pts,np=pts.length/3,maxPen=0,lo=0,hi=0,wx,wy,wz,fy,lim;
        for(i=0;i<np;i++){
          _rv.set(pts[3*i],pts[3*i+1],pts[3*i+2]).applyQuaternion(m.quaternion);
          wx=_rv.x+m.position.x; wy=_rv.y+m.position.y; wz=_rv.z+m.position.z;
          fy=-(cz-wz)*tH; if(wy<fy&&fy-wy>maxPen) maxPen=fy-wy;
          lim=(cz-wz)*tH*asp; if(wx+lim<lo)lo=wx+lim; if(wx-lim>hi)hi=wx-lim;
        }
        if(lo<0){ m.position.x-=lo; if(sc.vx<0)sc.vx=-sc.vx*0.3; }
        if(hi>0){ m.position.x-=hi; if(sc.vx>0)sc.vx=-sc.vx*0.3; }
        if(maxPen>0){ sc.contact=true; m.position.y+=maxPen; if(sc.vy<0) sc.vy=sc.vy<-2?-sc.vy*0.12:0; }
      }
      sc.floorT=sc.contact?sc.floorT+dt:0;
      if(sc.contact&&sc.floorT>0.5&&Math.abs(sc.vx)+Math.abs(sc.vy)<0.1&&Math.abs(sc.om)<0.1){ sc.still+=dt; if(sc.still>0.3){ sc.asleep=true; sc.camZ=cz; sc.asp=asp; sc.vx=sc.vy=sc.om=0; } } else sc.still=0;
      if(!sc.asleep&&sc.floorT>1.6&&Math.abs(sc.vx)+Math.abs(sc.vy)<0.6&&Math.abs(sc.om)<2){ sc.asleep=true; sc.camZ=cz; sc.asp=asp; sc.vx=sc.vy=sc.om=0; }
    }
  }

  // ---- spray paint: a paint layer (uPaint) lies on top of the poster; speckle, mist and runny drips are drawn into it ----
  var sprayOn=false, sprayDown=false, spX=0, spY=0, sprayLast=null, sprayT=0.3, sprayDripAmt=0.5, sprayRGB=[255,45,111];
  var sprayCv=null, sprayCx=null, sprayTex=null, sprayCW=2, sprayCH=2, sprayWet=null, sprayGW=1, drips=[];
  var sprayBlank=new THREE.DataTexture(new Uint8Array([0,0,0,0]),1,1,THREE.RGBAFormat); sprayBlank.needsUpdate=true;
  uniforms.uPaint={value:sprayBlank};
  function sprayRadius(){ return 0.06+1.1*sprayT*sprayT; } // world units
  function sprayRpx(){ return sprayRadius()*sprayCW/W; }
  function sprayReset(){ // a new poster gets a clean paint layer of its own shape
    var m=1024; sprayCW=W>=H?m:Math.max(8,Math.round(m*W/H)); sprayCH=W>=H?Math.max(8,Math.round(m*H/W)):m;
    if(sprayTex) sprayTex.dispose();
    sprayCv=document.createElement('canvas'); sprayCv.width=sprayCW; sprayCv.height=sprayCH; sprayCx=sprayCv.getContext('2d');
    sprayTex=new THREE.CanvasTexture(sprayCv); sprayTex.generateMipmaps=false; sprayTex.minFilter=THREE.LinearFilter; sprayTex.premultiplyAlpha=true;
    uniforms.uPaint.value=sprayTex;
    sprayGW=Math.ceil(sprayCW/16); sprayWet=new Float32Array(sprayGW*Math.ceil(sprayCH/16)); drips=[]; sprayLast=null;
  }
  function sprayClear(){
    if(!sprayCx) return; sprayCx.clearRect(0,0,sprayCW,sprayCH); drips=[]; sprayWet.fill(0); sprayTex.needsUpdate=true;
  }
  function spawnDrip(x,y,R){
    drips.push({x:x,y:y,v:(95+Math.random()*95)*sprayCW/1024,w:Math.max(1.5,Math.min(7,1.4+R*0.04))*(0.6+Math.random()*0.8),len:0,max:R*(1.6+Math.random()*3.6)+90,col:'rgb('+sprayRGB.join(',')+')'});
  }
  // one puff of paint at (x,y) in canvas pixels, dt seconds' worth
  function sprayDots(x,y,dt){
    var c=sprayCx,R=sprayRpx(),rgb=sprayRGB.join(','),i,nd=Math.min(900,Math.max(4,Math.round(Math.PI*R*R*1.8*dt)));
    var g=c.createRadialGradient(x,y,0,x,y,R*0.8),a=Math.min(0.35,0.14*dt*60); // soft mist: paint builds up the longer the can stays on a spot
    g.addColorStop(0,'rgba('+rgb+','+a+')'); g.addColorStop(0.55,'rgba('+rgb+','+(a*0.45)+')'); g.addColorStop(1,'rgba('+rgb+',0)');
    c.fillStyle=g; c.fillRect(x-R*0.8,y-R*0.8,R*1.6,R*1.6);
    c.fillStyle='rgb('+rgb+')'; // speckle: dense in the middle, thinning to a fine overspray
    for(i=0;i<nd;i++){
      var rr=Math.sqrt(-2*Math.log(1-Math.random()))*0.4*R; if(rr>1.5*R) continue;
      var an=Math.random()*6.2832,sz=0.7+Math.random()*1.5; c.globalAlpha=0.45+0.5*Math.random();
      c.fillRect(x+Math.cos(an)*rr-sz/2,y+Math.sin(an)*rr-sz/2,sz,sz);
    }
    c.globalAlpha=1;
    if(sprayDripAmt>0.01){ // dwell too long on one spot and the paint runs
      var gi=Math.floor(x/16)+Math.floor(y/16)*sprayGW;
      if(gi>=0&&gi<sprayWet.length){
        sprayWet[gi]+=dt; var thr=2.0-1.6*sprayDripAmt;
        if(sprayWet[gi]>thr&&drips.length<60){ sprayWet[gi]=thr*0.35; spawnDrip(x+(Math.random()-0.5)*R*0.8,y+Math.random()*R*0.15,R); }
      }
    }
  }
  function sprayStroke(x,y,dt){
    var R=sprayRpx();
    if(sprayLast){
      var dx=x-sprayLast[0],dy=y-sprayLast[1],d=Math.hypot(dx,dy),n=Math.min(24,Math.max(1,Math.ceil(d/Math.max(2,R*0.3)))),k;
      for(k=1;k<=n;k++) sprayDots(sprayLast[0]+dx*k/n,sprayLast[1]+dy*k/n,dt/n);
    } else sprayDots(x,y,dt);
    sprayLast=[x,y];
  }
  function stepDrips(dt){
    if(!drips.length) return false;
    var c=sprayCx,i,d,dy,nx;
    for(i=drips.length-1;i>=0;i--){
      d=drips[i]; dy=d.v*dt; nx=d.x+(Math.random()-0.5)*0.35;
      c.strokeStyle=d.col; c.fillStyle=d.col; c.lineWidth=d.w; c.lineCap='round'; c.globalAlpha=0.95;
      c.beginPath(); c.moveTo(d.x,d.y); c.lineTo(nx,d.y+dy); c.stroke();
      d.x=nx; d.y+=dy; d.len+=dy; d.v*=Math.exp(-0.5*dt); if(d.len>0.6*d.max) d.v*=Math.exp(-1.6*dt);
      if(d.len>=d.max||d.v<5||d.y>=sprayCH){ c.beginPath(); c.arc(d.x,d.y,d.w*0.85,0,6.2832); c.fill(); drips.splice(i,1); } // the drop that hangs at the end
    }
    c.globalAlpha=1; return true;
  }
  function stepSpray(dt){
    if(!sprayCx||!sheet) return;
    var changed=false,i;
    if(sprayDown&&mode!=='spray') sprayDown=false;
    if(sprayOn&&sprayDown){
      var r=canvas.getBoundingClientRect();
      ndc.set((spX-r.left)/r.width*2-1,-((spY-r.top)/r.height)*2+1); ray.setFromCamera(ndc,camera); group.updateMatrixWorld(true);
      var hs=ray.intersectObject(poster).filter(function(h){return !ripTorn(h.uv);});
      if(hs.length){ sprayStroke(hs[0].uv.x*sprayCW,(1-hs[0].uv.y)*sprayCH,dt); changed=true; } else sprayLast=null;
    }
    if(stepDrips(dt)) changed=true;
    var dec=Math.exp(-0.8*dt); for(i=0;i<sprayWet.length;i++) sprayWet[i]*=dec;
    if(changed) sprayTex.needsUpdate=true;
  }

  // ---- flame mode: hold the nozzle on the paper and it scorches, catches, chars and burns through; flames, smoke and sparks rise from the burning edge ----
  var burnOn=false, burnDown=false, bnX=0, bnY=0, burnT=0.3, burnSpread=0.35;
  var BW=2,BH=2,bB=null,bF=null,bGen=null,bRate=null,bDry=null,bHeat=null,bGlow=null,bData=null,bTex=null,bAct=[],bInAct=null,bDirty=false;
  var burnBlank=new THREE.DataTexture(new Uint8Array([0,0,0,255]),1,1,THREE.RGBAFormat); burnBlank.needsUpdate=true;
  uniforms.uBurn={value:burnBlank}; uniforms.uBR={value:new THREE.Vector2(1,1)};
  var psScale={value:1}, psFlame=null, psSmoke=null, psSpark=null, _bv=new THREE.Vector3();
  function burnRadius(){ return 0.08+0.85*burnT*burnT; } // world units
  function burnReset(){ // a fresh, unburnt sheet (also used when a new poster arrives)
    var m=320; BW=W>=H?m:Math.max(8,Math.round(m*W/H)); BH=W>=H?Math.max(8,Math.round(m*H/W)):m;
    var n=BW*BH,i;
    bB=new Float32Array(n); bF=new Uint8Array(n); bGen=new Uint8Array(n); bHeat=new Float32Array(n); bGlow=new Float32Array(n);
    bRate=new Float32Array(n); bDry=new Float32Array(n); bInAct=new Uint8Array(n); bAct=[]; bData=new Uint8Array(n*4);
    for(i=0;i<n;i++){ bRate[i]=0.75+Math.random()*0.6; bDry[i]=0.25+Math.random()*1.5; }
    if(bTex) bTex.dispose();
    bTex=new THREE.DataTexture(bData,BW,BH,THREE.RGBAFormat); bTex.minFilter=bTex.magFilter=THREE.LinearFilter; bTex.generateMipmaps=false; bTex.needsUpdate=true;
    uniforms.uBurn.value=bTex; uniforms.uBR.value.set(BW,BH); bDirty=false;
    [psFlame,psSmoke,psSpark].forEach(function(p){ if(p) psClear(p); });
  }
  function igniteCell(i,gen){
    bF[i]=1; bGen[i]=gen; bHeat[i]=1; if(bB[i]<0.05) bB[i]=0.05;
    if(!bInAct[i]){ bInAct[i]=1; bAct.push(i); }
  }
  // the nozzle's heat: cells under it warm up (scorch) and, after a moment, catch
  function burnHeat(cx,cy,dt){
    var R=burnRadius()*BW/W,x,y,i,d,w,dx,dy,maxGen=2+Math.round(burnSpread*110);
    var y0=Math.max(0,Math.floor(cy-R)),y1=Math.min(BH-1,Math.ceil(cy+R)),x0=Math.max(0,Math.floor(cx-R)),x1=Math.min(BW-1,Math.ceil(cx+R));
    for(y=y0;y<=y1;y++) for(x=x0;x<=x1;x++){
      dx=x-cx; dy=y-cy; d=Math.sqrt(dx*dx+dy*dy)/R; if(d>=1) continue;
      i=y*BW+x; if(bF[i]||bB[i]>=0.5) continue;
      w=1-d*d; bHeat[i]+=dt*3.4*w*w*bDry[i]*0.8;
      if(bB[i]<0.2){ var sc=Math.min(0.2,bHeat[i]*0.2); if(sc>bB[i]){ bB[i]=sc; bData[4*i]=(sc*255)|0; bDirty=true; } }
      if(bHeat[i]>=1){ igniteCell(i,maxGen); }
    }
  }
  var NB=[[-1,0,1],[1,0,1],[0,-1,1],[0,1,1],[-1,-1,0.7],[1,-1,0.7],[-1,1,0.7],[1,1,0.7]];
  function burnFire(dt){
    var k,i,j,x,y,q,nb,pr=(6+burnSpread*40)*dt,cap,e=Math.exp(-2.5*dt);
    for(k=bAct.length-1;k>=0;k--){
      i=bAct[k];
      if(bF[i]){
        bB[i]+=dt*1.15*bRate[i]; bGlow[i]=1;
        cap=bGen[i]>=2?1:(bGen[i]===1?0.8:0.62);
        if(bB[i]>=cap){ bB[i]=cap; bF[i]=0; }
        else if(bB[i]>0.12&&bGen[i]>0){
          x=i%BW; y=(i/BW)|0;
          for(q=0;q<8;q++){
            nb=NB[q]; var nx=x+nb[0],ny=y+nb[1]; if(nx<0||ny<0||nx>=BW||ny>=BH) continue;
            j=ny*BW+nx; if(bF[j]||bB[j]>=0.3) continue;
            if(Math.random()<pr*bDry[j]*nb[2]) igniteCell(j,bGen[i]-1);
          }
        }
      } else bGlow[i]*=e;
      bData[4*i]=Math.min(255,(bB[i]*255)|0); bData[4*i+1]=(bGlow[i]*255)|0;
      if(!bF[i]&&bGlow[i]<0.02){ bGlow[i]=0; bData[4*i+1]=0; bInAct[i]=0; bAct[k]=bAct[bAct.length-1]; bAct.pop(); }
    }
    return true;
  }
  // ----- particles: flames and sparks glow (additive), smoke darkens (normal blend) -----
  function makePS(N,kind,blend){
    var g=new THREE.BufferGeometry(),pos=new Float32Array(N*3),sz=new Float32Array(N),ag=new Float32Array(N),i;
    for(i=0;i<N;i++) ag[i]=1;
    g.setAttribute('position',new THREE.BufferAttribute(pos,3)); g.setAttribute('aSize',new THREE.BufferAttribute(sz,1)); g.setAttribute('aAge',new THREE.BufferAttribute(ag,1));
    var m=new THREE.ShaderMaterial({uniforms:{uScale:psScale,uKind:{value:kind}},transparent:true,depthWrite:false,blending:blend,
      vertexShader:'attribute float aSize; attribute float aAge; uniform float uScale; varying float vAge; void main(){ vAge=aAge; vec4 mv=modelViewMatrix*vec4(position,1.0); gl_Position=projectionMatrix*mv; gl_PointSize=min(160.0,aSize*uScale/max(0.05,-mv.z)); }',
      fragmentShader:['uniform float uKind; varying float vAge;','void main(){ vec2 c=gl_PointCoord-0.5; float d=length(c)*2.0; if(d>1.0) discard; float a=1.0-d; a*=a; vec3 col; float al;',
        ' if(uKind<0.5){ col=mix(vec3(1.0,0.92,0.55),vec3(1.0,0.45,0.08),smoothstep(0.0,0.4,vAge)); col=mix(col,vec3(0.55,0.08,0.02),smoothstep(0.4,1.0,vAge)); al=a*(1.0-vAge)*0.85; }',
        ' else if(uKind<1.5){ col=vec3(0.13,0.12,0.12); al=a*0.34*smoothstep(0.0,0.15,vAge)*(1.0-vAge); }',
        ' else { col=mix(vec3(1.0,0.85,0.4),vec3(1.0,0.3,0.05),vAge); al=smoothstep(1.0,0.25,d)*(1.0-vAge); }',
        ' gl_FragColor=vec4(col,al); }'].join('\n')});
    var pts=new THREE.Points(g,m); pts.frustumCulled=false; pts.renderOrder=5; scene.add(pts);
    return {g:g,pos:pos,sz:sz,ag:ag,N:N,vx:new Float32Array(N),vy:new Float32Array(N),vz:new Float32Array(N),life:new Float32Array(N),age:ag,s0:new Float32Array(N),grow:new Float32Array(N),next:0,alive:0,was:false};
  }
  function psClear(p){ p.ag.fill(1); p.sz.fill(0); p.alive=0; p.was=true; }
  function psAdd(p,x,y,z,vx,vy,vz,life,size,grow){
    var i=p.next; p.next=(i+1)%p.N; p.pos[3*i]=x; p.pos[3*i+1]=y; p.pos[3*i+2]=z; p.vx[i]=vx; p.vy[i]=vy; p.vz[i]=vz;
    p.life[i]=life; p.age[i]=0; p.s0[i]=size; p.grow[i]=grow; p.sz[i]=size;
  }
  function psStep(p,dt,grav,drag){
    var i,a=0,dk=Math.exp(-drag*dt);
    for(i=0;i<p.N;i++){
      if(p.age[i]>=1) continue;
      p.age[i]+=dt/p.life[i];
      if(p.age[i]>=1){ p.age[i]=1; p.sz[i]=0; continue; }
      p.vy[i]+=grav*dt; p.vx[i]*=dk; p.vz[i]*=dk; if(drag>0) p.vy[i]*=dk;
      p.pos[3*i]+=p.vx[i]*dt; p.pos[3*i+1]+=p.vy[i]*dt; p.pos[3*i+2]+=p.vz[i]*dt;
      p.sz[i]=p.s0[i]*(1+p.grow[i]*p.age[i]); a++;
    }
    p.alive=a;
    if(a>0||p.was){ p.g.attributes.position.needsUpdate=true; p.g.attributes.aSize.needsUpdate=true; p.g.attributes.aAge.needsUpdate=true; p.was=a>0; }
  }
  function burnEmit(u,v,heavy){ // a flame (and now and then smoke or a spark) from a spot of the burning paper
    if(ripPresent&&ripPresent[Math.min(ripMH-1,Math.floor(v*ripMH))*ripMW+Math.min(ripMW-1,Math.floor(u*ripMW))]===0) return;
    simPt((u-0.5)*W,(v-0.5)*H,_o,0.03); _bv.set(_o.x,_o.y,_o.z); poster.localToWorld(_bv);
    var r=Math.random;
    psAdd(psFlame,_bv.x+(r()-0.5)*0.04,_bv.y,_bv.z,(r()-0.5)*0.18,0.5+r()*0.7,(r()-0.2)*0.12,0.4+r()*0.45,0.17+r()*0.2,0.7);
    if(r()<0.28) psAdd(psSmoke,_bv.x,_bv.y+0.05,_bv.z,(r()-0.5)*0.12,0.35+r()*0.35,0.04,1.5+r()*1.2,0.22+r()*0.15,2.6);
    if(r()<0.1) psAdd(psSpark,_bv.x,_bv.y,_bv.z+0.02,(r()-0.5)*0.9,0.5+r()*1.3,(r()-0.5)*0.3,0.7+r()*1.2,0.045+r()*0.04,0);
  }
  function burnFx(dt,hit){
    var n=bAct.length,t,tries,i;
    if(n&&!shred){
      group.updateMatrixWorld(true);
      tries=Math.min(22,3+((n/25)|0));
      for(t=0;t<tries;t++){ i=bAct[(Math.random()*n)|0]; if(!bF[i]||bB[i]<0.3) continue; burnEmit(((i%BW)+0.5)/BW,(((i/BW)|0)+0.5)/BH); }
    }
    if(hit){ // the jet itself, leaving the nozzle even before anything has caught
      var R=burnRadius(),k,r=Math.random,a,rr; camera.getWorldDirection(dirV);
      for(k=0;k<7;k++){
        a=r()*6.2832; rr=Math.sqrt(r())*R*0.85;
        psAdd(psFlame,hit.x+Math.cos(a)*rr-dirV.x*0.04,hit.y+Math.sin(a)*rr*0.6,hit.z-dirV.z*0.04+0.02,(r()-0.5)*0.3,0.6+r()*1.0,(r()-0.5)*0.15,0.3+r()*0.35,0.1+R*0.25*r()+0.06,0.8);
      }
      if(r()<0.5) psAdd(psSpark,hit.x+(r()-0.5)*R,hit.y,hit.z+0.03,(r()-0.5)*1.0,0.6+r()*1.4,(r()-0.5)*0.3,0.7+r()*1.0,0.05+r()*0.04,0);
    }
    psStep(psFlame,dt,0.9,1.2); psStep(psSmoke,dt,0.15,0.9); psStep(psSpark,dt,-0.7,0.6);
  }
  psFlame=makePS(1600,0,THREE.AdditiveBlending); psSmoke=makePS(800,1,THREE.NormalBlending); psSpark=makePS(500,2,THREE.AdditiveBlending);
  function stepBurn(dt){
    if(!bB||!sheet) return;
    if(burnDown&&mode!=='burn') burnDown=false;
    psScale.value=renderer.domElement.height/(2*tanHalf);
    var hit=null;
    if(burnOn&&burnDown&&!shred&&!sheet.tgt){
      var r=canvas.getBoundingClientRect();
      ndc.set((bnX-r.left)/r.width*2-1,-((bnY-r.top)/r.height)*2+1); ray.setFromCamera(ndc,camera); group.updateMatrixWorld(true);
      var hs=ray.intersectObject(poster).filter(function(h){return !ripTorn(h.uv);});
      if(hs.length){ hit=hs[0].point; burnHeat(hs[0].uv.x*BW,hs[0].uv.y*BH,dt); bDirty=true; }
    }
    if(bAct.length){ burnFire(dt); bDirty=true; }
    if(bDirty){ bTex.needsUpdate=true; bDirty=false; }
    burnFx(dt,hit);
  }

  function setImage(img){
    var tex=new THREE.Texture(img); tex.needsUpdate=true; tex.minFilter=THREE.LinearMipmapLinearFilter;
    tex.anisotropy=renderer.capabilities.getMaxAnisotropy();
    if(uniforms.uMap.value) uniforms.uMap.value.dispose();
    uniforms.uMap.value=tex;
    var ar=img.width/img.height, maxW=3.6, maxH=4.4;
    H=maxH; W=H*ar; if(W>maxW){W=maxW;H=W/ar;}
    poster.geometry.dispose();
    folds=[];foldAnim=null;foldBtns(); sheet=makeSheet(W,H); poster.geometry=new THREE.PlaneGeometry(W,H,sheet.nx,sheet.ny); poster.frustumCulled=false;
    uniforms.uSize.value.set(W,H);
    ripResetMask(); fragReset(); sprayReset(); burnReset();
    if(shred) restoreShred();
    setFlameGeom();
    shadow.scale.set(W*1.15,H*1.15,1);
  }

  // default sample poster
  (function(){
    var c=document.createElement('canvas'); c.width=800; c.height=1100; var x=c.getContext('2d');
    x.fillStyle='#000'; x.fillRect(0,0,800,1100);
    x.fillStyle='#fff'; x.font='700 112px sans-serif'; x.textAlign='center'; x.textBaseline='middle';
    x.fillText('DROP YOUR',400,490); x.fillText('POSTER',400,620);
    setImage(c);
  })();

  function loadFile(f){
    if(f&&/\.glb$/i.test(f.name)){loadModel(f);return;}
    if(!f||!/^image\//.test(f.type)) return;
    var url=URL.createObjectURL(f), im=new Image();
    im.onload=function(){setImage(im); URL.revokeObjectURL(url);};
    im.src=url;
  }
  var over=0;
  window.addEventListener('dragenter',function(e){e.preventDefault();over++;document.body.classList.add('over');});
  window.addEventListener('dragleave',function(e){e.preventDefault();if(--over<=0){over=0;document.body.classList.remove('over');}});
  window.addEventListener('dragover',function(e){e.preventDefault();});
  window.addEventListener('drop',function(e){e.preventDefault();over=0;document.body.classList.remove('over');Array.prototype.forEach.call(e.dataTransfer.files,loadFile);});
  var fileIn=document.getElementById('file');
  document.getElementById('open').onclick=function(){fileIn.click();};
  fileIn.onchange=function(){loadFile(fileIn.files[0]);fileIn.value='';};

  // ---- 3D model (GLB) ----
  var models=[], sel=null, spinning=true, mPos0=new THREE.Vector3(), mStart0=new THREE.Vector3();
  var ambL=new THREE.AmbientLight(0xffffff,0.3); scene.add(ambL);
  var dirL=new THREE.DirectionalLight(0xffffff,1.1); scene.add(dirL);
  renderer.outputEncoding=THREE.sRGBEncoding;
  var mstat=document.getElementById('mstat'), spinBtn=document.getElementById('spin'), mlist=document.getElementById('mlist');
  var msEl=document.getElementById('msize'), msOut=document.getElementById('vMS');
  function updSize(){
    msEl.style.setProperty('--p',(msEl.value-msEl.min)/(msEl.max-msEl.min)*100+'%');
    msOut.textContent=Math.round(msEl.value*100)+'%';
    if(sel){ sel.userData.k=+msEl.value; sel.scale.setScalar(sel.userData.base*sel.userData.k); }
  }
  msEl.addEventListener('input',updSize);
  function renderList(){
    mlist.textContent='';
    models.forEach(function(m,i){
      var b=document.createElement('button'); b.textContent=(i+1)+'. '+m.userData.name;
      b.style.cssText='flex:none;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:5px 9px;font-size:12px;'+(m===sel?'border-color:#fff;background:rgba(255,255,255,.25)':'');
      b.onclick=function(){select(m);};
      mlist.appendChild(b);
    });
  }
  function select(m){
    sel=m; msEl.disabled=!m;
    if(m) msEl.value=m.userData.k;
    updSize(); renderList(); syncDepth();
    if(m) mstat.textContent='Selected: '+m.userData.name+'. Drag to move, Shift+drag or scroll to move in depth, slider to resize.';
  }
  function disposeModel(m){
    if(!m) return;
    group.remove(m);
    m.traverse(function(o){
      if(o.geometry) o.geometry.dispose();
      if(o.material){ (Array.isArray(o.material)?o.material:[o.material]).forEach(function(mm){
        for(var k in mm){ if(mm[k]&&mm[k].isTexture) mm[k].dispose(); } mm.dispose(); }); }
    });
    var i=models.indexOf(m); if(i>=0) models.splice(i,1);
    if(sel===m) select(models[models.length-1]||null); else renderList();
  }
  function loadModel(f){
    mstat.textContent='Loading '+f.name+'\u2026';
    var rd=new FileReader();
    rd.onload=function(){
      new GLTFLoader().parse(rd.result,'',function(gltf){
        var obj=gltf.scene, box=new THREE.Box3().setFromObject(obj), size=box.getSize(new THREE.Vector3()), ctr=box.getCenter(new THREE.Vector3());
        obj.position.sub(ctr);
        var inner=new THREE.Group(); inner.add(obj);
        var m=new THREE.Group(); m.add(inner);
        m.userData={name:f.name.replace(/\.glb$/i,''),base:2/Math.max(size.x,size.y,size.z,1e-6),k:1,dims:size.clone()};
        m.scale.setScalar(m.userData.base);
        var n=models.length;
        m.position.set(-W*0.3+(n%4)*W*0.2,-H*0.2+Math.floor(n/4)*0.6,1.0);
        if(gravityOn){m.userData.home=m.position.clone(); m.userData.vy=0;} group.add(m); models.push(m); select(m);
      },function(err){ mstat.textContent='Could not read '+f.name+'. Please use a valid .glb.'; });
    };
    rd.readAsArrayBuffer(f);
  }
  var fileM=document.getElementById('fileM');
  document.getElementById('openModel').onclick=function(){fileM.click();};
  fileM.onchange=function(){ Array.prototype.forEach.call(fileM.files,loadModel); fileM.value=''; };
  document.getElementById('rmModel').onclick=function(){ disposeModel(sel); if(!models.length) mstat.textContent='No models. Drop or add a .glb.'; };
  spinBtn.onclick=function(){ spinning=!spinning; spinBtn.textContent=spinning?'Stop spinning':'Start spinning'; };
  var gravityOn=false, _bx=new THREE.Box3(), _wp=new THREE.Vector3();
  var dropBtn=document.getElementById('drop3d');
  dropBtn.onclick=function(){
    gravityOn=!gravityOn;
    if(gravityOn){
      models.forEach(function(m){ m.userData.home=m.position.clone(); m.userData.vx=0; m.userData.vy=0; });
      dropBtn.textContent='Reset positions';
      mstat.textContent='Models fall, collide by their real size and stack on the bottom edge. Drag one to pick it up and drop it again.';
    } else {
      models.forEach(function(m){ if(m.userData.home) m.position.copy(m.userData.home); m.userData.vx=0; m.userData.vy=0; });
      dropBtn.textContent='Drop models';
    }
  };
  var mzEl=document.getElementById('mzs'), mzOut=document.getElementById('vMZ');
  function syncDepth(){
    if(!sel){ mzEl.disabled=true; mzOut.textContent='0.0'; return; }
    mzEl.disabled=false; mzEl.value=sel.position.z;
    mzEl.style.setProperty('--p',(mzEl.value-mzEl.min)/(mzEl.max-mzEl.min)*100+'%'); mzOut.textContent=sel.position.z.toFixed(1);
  }
  mzEl.addEventListener('input',function(){ if(sel){ sel.position.z=+mzEl.value; syncDepth(); } });
  // Collisions use each model's real bounding box in the world (spin, size and the turned poster
  // included) in all three axes, and the canvas edges are worked out at the depth of the model's front face.
  function stepGravity(dt){
    group.updateMatrixWorld(true);
    var n=models.length; if(!n) return;
    var P=[],HH=[],OFF=[],S=[],V=[],i,j,it,st,SUB=3,h=dt/SUB,E=0.25,tanW=tanHalf*camera.aspect;
    for(i=0;i<n;i++){
      var m=models[i],u=m.userData;
      if(u.vx===undefined)u.vx=0; if(u.vy===undefined)u.vy=0; if(u.vz===undefined)u.vz=0;
      var pw=new THREE.Vector3(); m.getWorldPosition(pw);
      _bx.setFromObject(m);
      var c=_bx.getCenter(new THREE.Vector3()), hf=_bx.getSize(new THREE.Vector3()).multiplyScalar(0.485);
      OFF.push(pw.sub(c)); P.push(c); HH.push(hf); V.push(8*hf.x*hf.y*hf.z+1e-6);
      S.push(mode==='model'&&sel===m);
      if(S[i]){u.vx=0;u.vy=0;u.vz=0;}
    }
    for(st=0;st<SUB;st++){
      for(i=0;i<n;i++){ if(S[i]) continue; var u1=models[i].userData; u1.vy-=18*h; P[i].x+=u1.vx*h; P[i].y+=u1.vy*h; P[i].z+=u1.vz*h; }
      for(it=0;it<4;it++){
        for(i=0;i<n;i++){
          if(S[i]) continue;
          var u2=models[i].userData, depth=Math.max(0.3,camera.position.z-(P[i].z+HH[i].z));
          var fy=-depth*tanHalf+HH[i].y, hw=depth*tanW-HH[i].x;
          if(P[i].y<fy){ P[i].y=fy; if(u2.vy<0) u2.vy=u2.vy<-1.2?-u2.vy*0.3:0; u2.vx*=0.94; u2.vz*=0.94; }
          if(P[i].x<-hw){ P[i].x=-hw; if(u2.vx<0) u2.vx=-u2.vx*0.3; }
          if(P[i].x>hw){ P[i].x=hw; if(u2.vx>0) u2.vx=-u2.vx*0.3; }
          if(P[i].z>5){P[i].z=5; if(u2.vz>0)u2.vz=0;} if(P[i].z<-5){P[i].z=-5; if(u2.vz<0)u2.vz=0;}
        }
        for(i=0;i<n;i++) for(j=i+1;j<n;j++){
          var dx=P[j].x-P[i].x, dy=P[j].y-P[i].y, dz=P[j].z-P[i].z;
          var ox=HH[i].x+HH[j].x-Math.abs(dx), oy=HH[i].y+HH[j].y-Math.abs(dy), oz=HH[i].z+HH[j].z-Math.abs(dz);
          if(ox<=0||oy<=0||oz<=0) continue;
          var ia=S[i]?0:1/V[i], ib=S[j]?0:1/V[j], is=ia+ib; if(is===0) continue;
          var nx=0,ny=0,nz=0,pen;
          if(oy<=ox&&oy<=oz){ ny=dy>=0?1:-1; pen=oy; if(Math.abs(dy)<1e-4) ny=(i<j?1:-1); }
          else if(oz<=ox){ nz=dz>=0?1:-1; pen=oz; }
          else { nx=dx>=0?1:-1; pen=ox; }
          P[i].x-=nx*pen*ia/is; P[i].y-=ny*pen*ia/is; P[i].z-=nz*pen*ia/is;
          P[j].x+=nx*pen*ib/is; P[j].y+=ny*pen*ib/is; P[j].z+=nz*pen*ib/is;
          var ui=models[i].userData, uj=models[j].userData;
          var vn=(uj.vx-ui.vx)*nx+(uj.vy-ui.vy)*ny+(uj.vz-ui.vz)*nz;
          if(vn<0){
            var jm=-(1+E)*vn/is;
            ui.vx-=jm*ia*nx; ui.vy-=jm*ia*ny; ui.vz-=jm*ia*nz; uj.vx+=jm*ib*nx; uj.vy+=jm*ib*ny; uj.vz+=jm*ib*nz;
          }
          if(ny!==0){ var fr=Math.pow(0.9,dt*60/SUB); ui.vx*=fr; uj.vx*=fr; ui.vz*=fr; uj.vz*=fr; }
        }
      }
    }
    for(i=0;i<n;i++){ if(!S[i]) models[i].position.copy(group.worldToLocal(P[i].clone().add(OFF[i]))); }
    if(sel) syncDepth();
  }
  select(null);

  // ---- GUI ----
  function bind(id,out,fmt,fn){
    var el=document.getElementById(id), o=document.getElementById(out);
    function u(){var p=(el.value-el.min)/(el.max-el.min)*100; el.style.setProperty('--p',p+'%'); o.textContent=fmt(+el.value); fn(+el.value);}
    el.addEventListener('input',u); u();
  }
  bind('light','vLight',function(v){return v.toFixed(2)},function(v){uniforms.uLight.value=v;});
  bind('amb','vAmb',function(v){return v.toFixed(2)},function(v){uniforms.uAmb.value=v;});
  bind('gloss','vGloss',function(v){return v.toFixed(2)},function(v){uniforms.uGloss.value=v;});
  bind('pix','vPix',function(v){return Math.round(v*100)+'%'},function(v){uniforms.uPix.value=v;});
  bind('soft','vSoft',function(v){return v.toFixed(1)},function(v){uniforms.uRadius.value=v;});
  bind('half','vHalf',function(v){return Math.round(v*100)+'%'},function(v){uniforms.uHalf.value=v;});
  bind('hs','vHS',function(v){return Math.round(v*100)+'%'},function(v){uniforms.uHSize.value=v;});
  bind('fire','vFire',function(v){return Math.round(v*100)+'%'},function(v){uniforms.uFire.value=v;});
  bind('flame','vFlame',function(v){return Math.round(v*100)+'%'},function(v){uniforms.uFlame.value=v;});
  bind('wind','vWind',function(v){return v.toFixed(2)},function(v){uniforms.uWind.value=v;});

  var pad=document.getElementById('pad'), lp={x:.7,y:.25};
  function setPad(e){
    var r=pad.getBoundingClientRect();
    lp.x=Math.min(1,Math.max(0,(e.clientX-r.left)/r.width)); lp.y=Math.min(1,Math.max(0,(e.clientY-r.top)/r.height));
    pad.style.setProperty('--x',lp.x*100+'%'); pad.style.setProperty('--y',lp.y*100+'%');
    uniforms.uLightPos.value.set((lp.x-.5)*9,-(lp.y-.5)*7,3.6);
  }
  var padDown=false;
  pad.addEventListener('pointerdown',function(e){padDown=true;pad.setPointerCapture(e.pointerId);setPad(e);});
  pad.addEventListener('pointermove',function(e){if(padDown)setPad(e);});
  pad.addEventListener('pointerup',function(){padDown=false;});
  setPad({clientX:pad.getBoundingClientRect().left+pad.offsetWidth*.7,clientY:pad.getBoundingClientRect().top+pad.offsetHeight*.25});

  var panel=document.getElementById('panel'), tg=document.getElementById('toggle');
  tg.onclick=function(){panel.classList.toggle('min');tg.textContent=panel.classList.contains('min')?'Show':'Hide';};

  // ---- interaction ----
  var rot={x:0,y:0}, rotT={x:0,y:0}, mode=null, start=new THREE.Vector3(), lastX=0, lastY=0;
  var pull=new THREE.Vector3(), vel=new THREE.Vector3(), target=new THREE.Vector3();
  var wStart=new THREE.Vector3(), wCur=new THREE.Vector3(), wd=new THREE.Vector3(), dirV=new THREE.Vector3(), dragPlane=new THREE.Plane(), ray=new THREE.Raycaster(), inv=new THREE.Matrix4(), ndc=new THREE.Vector2();
  function localHit(e){
    var r=canvas.getBoundingClientRect();
    ndc.set((e.clientX-r.left)/r.width*2-1,-((e.clientY-r.top)/r.height)*2+1);
    ray.setFromCamera(ndc,camera);
    group.updateMatrixWorld(true); inv.copy(poster.matrixWorld).invert();
    var o=ray.ray.origin.clone().applyMatrix4(inv), d=ray.ray.direction.clone().transformDirection(inv);
    if(Math.abs(d.z)<1e-5) return null;
    var t=-o.z/d.z; return o.add(d.multiplyScalar(t));
  }
  canvas.addEventListener('pointerdown',function(e){
    try{canvas.setPointerCapture(e.pointerId);}catch(_){} canvas.classList.add('drag');
    lastX=e.clientX; lastY=e.clientY;
    var r0=canvas.getBoundingClientRect();
    ndc.set((e.clientX-r0.left)/r0.width*2-1,-((e.clientY-r0.top)/r0.height)*2+1);
    ray.setFromCamera(ndc,camera); group.updateMatrixWorld(true);
    var hits=(shred||(sheet&&sheet.tgt))?[]:ray.intersectObject(poster).filter(function(h){return !ripTorn(h.uv);});
    var mh=models.length?ray.intersectObjects(models,true):[];
    if(mh.length&&(!hits.length||mh[0].distance<hits[0].distance)){
      mode='model'; wStart.copy(mh[0].point);
      camera.getWorldDirection(dirV); dragPlane.setFromNormalAndCoplanarPoint(dirV,wStart);
      var root=mh[0].object; while(root.parent&&root.parent!==group) root=root.parent;
      select(root); mStart0.copy(group.worldToLocal(wStart.clone())); mPos0.copy(root.position);
    } else if(hits.length&&burnOn){
      mode='burn'; burnDown=true; bnX=e.clientX; bnY=e.clientY;
    } else if(hits.length&&sprayOn){
      mode='spray'; sprayDown=true; spX=e.clientX; spY=e.clientY; sprayLast=null;
    } else if(hits.length&&tearOn){
      mode=tearMouseStart(e)?'tear':'rotate';
    } else if(hits.length&&ripOn){
      var rs=doRip(hits[0].uv);
      if(rs){
        mode='rip'; ripScrap=rs; wStart.copy(hits[0].point); camera.getWorldDirection(dirV); dragPlane.setFromNormalAndCoplanarPoint(dirV,wStart);
        rs.start=rs.mesh.position.clone(); rs.lastT=performance.now();
      } else mode='rotate';
    } else if(hits.length){
      wStart.copy(hits[0].point);
      var p=poster.worldToLocal(wStart.clone()), huv=hits[0].uv;
      var gidx=sheet.near(huv.x*W,(1-huv.y)*H,0.2*uniforms.uRadius.value);
      sheet.doGrab(gidx,[p.x,p.y,p.z]); mode='bend';
      camera.getWorldDirection(dirV); dragPlane.setFromNormalAndCoplanarPoint(dirV,wStart);
    } else mode='rotate';
  });
  canvas.addEventListener('pointermove',function(e){
    if(mode==='bend'){
      var r1=canvas.getBoundingClientRect();
      ndc.set((e.clientX-r1.left)/r1.width*2-1,-((e.clientY-r1.top)/r1.height)*2+1);
      ray.setFromCamera(ndc,camera);
      if(!ray.ray.intersectPlane(dragPlane,wCur)) return;
      group.updateMatrixWorld(true);
      var lg=poster.worldToLocal(wCur.clone()); sheet.moveGrab([lg.x,lg.y,lg.z]);
    } else if(mode==='rip'&&ripScrap){
      var r3=canvas.getBoundingClientRect(), rsc=ripScrap;
      ndc.set((e.clientX-r3.left)/r3.width*2-1,-((e.clientY-r3.top)/r3.height)*2+1);
      ray.setFromCamera(ndc,camera);
      if(!ray.ray.intersectPlane(dragPlane,wCur)) return;
      var nx3=rsc.start.x+wCur.x-wStart.x, ny3=rsc.start.y+wCur.y-wStart.y, now3=performance.now(), dt3=Math.max(8,now3-rsc.lastT)/1000;
      rsc.vx=Math.max(-14,Math.min(14,rsc.vx*0.5+0.5*(nx3-rsc.mesh.position.x)/dt3)); rsc.vy=Math.max(-14,Math.min(14,rsc.vy*0.5+0.5*(ny3-rsc.mesh.position.y)/dt3));
      rsc.mesh.position.x=nx3; rsc.mesh.position.y=ny3; rsc.lastT=now3;
    } else if(mode==='tear'){ tearMouseMove(e);
    } else if(mode==='burn'){ bnX=e.clientX; bnY=e.clientY;
    } else if(mode==='spray'){ spX=e.clientX; spY=e.clientY;
    } else if(mode==='model'&&sel){
      var r2=canvas.getBoundingClientRect();
      ndc.set((e.clientX-r2.left)/r2.width*2-1,-((e.clientY-r2.top)/r2.height)*2+1);
      ray.setFromCamera(ndc,camera);
      if(!ray.ray.intersectPlane(dragPlane,wCur)) return;
      group.updateMatrixWorld(true);
      var lc=group.worldToLocal(wCur.clone());
      if(e.shiftKey){
        sel.position.z=Math.max(-4,Math.min(4,sel.position.z+(lastY-e.clientY)*0.02));
        mPos0.x=sel.position.x; mPos0.y=sel.position.y; mStart0.copy(lc);
      } else {
        sel.position.x=mPos0.x+lc.x-mStart0.x;
        sel.position.y=mPos0.y+lc.y-mStart0.y;
      }
      lastX=e.clientX; lastY=e.clientY; syncDepth();
    } else if(mode==='rotate'){
      rotT.y+=(e.clientX-lastX)*0.008; rotT.x+=(e.clientY-lastY)*0.008;
      rotT.x=Math.max(-1.2,Math.min(1.2,rotT.x)); lastX=e.clientX; lastY=e.clientY;
    }
  });
  function up(){
    if(mode==='spray'){ sprayDown=false; sprayLast=null; }
    if(mode==='burn') burnDown=false;
    if(mode==='tear') tearEnd();
    if(mode==='bend'&&sheet)sheet.release();
    if(mode==='rip'&&ripScrap){ // let go: the torn piece falls, carrying the speed it was dragged at
      var rs=ripScrap; rs.held=false; if(performance.now()-rs.lastT>90){ rs.vx*=0.2; rs.vy*=0.2; }
      rs.om=(Math.random()-0.5)*3+rs.vx*0.12; ripScrap=null; scrapToCloth(rs);
    }
    mode=null;canvas.classList.remove('drag');
  }
  canvas.addEventListener('pointerup',up); canvas.addEventListener('pointercancel',up);
  canvas.addEventListener('wheel',function(e){e.preventDefault();if(mode==='model'&&sel){sel.position.z=Math.max(-4,Math.min(4,sel.position.z-e.deltaY*0.004));syncDepth();return;}camZT=Math.max(ZMIN,Math.min(ZMAX,camZT*Math.exp(e.deltaY*(e.ctrlKey?0.012:0.0025))));},{passive:false});
  document.getElementById('reset').onclick=function(){rotT.x=rotT.y=0;camZT=8.5;};


  // ---- hand control (webcam pinch + drag) ----
  var vid=document.getElementById('vid'), ov=document.getElementById('ov'), ovx=ov.getContext('2d');
  var camEl=document.getElementById('cam'), hcEl=document.getElementById('hc');
  var handBtn=document.getElementById('hand'), stat=document.getElementById('stat');
  var pxc=document.createElement('canvas'); pxc.width=36; pxc.height=27; var pxx=pxc.getContext('2d');
  var zref=null, zs=0, zCnt=0;
  var landmarker=null, handOn=false, stream=null, down=false, pinchS=[false,false], zoom=null, sx=0, sy=0, lastT=-1;
  var VER='0.10.14', BASE='https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@'+VER;
  var MODEL='https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
  function fire(type,x,y){canvas.dispatchEvent(new PointerEvent(type,{clientX:x,clientY:y,pointerId:77,bubbles:true,isPrimary:true}));}
  function endGrab(){ if(down){fire('pointerup',sx,sy);down=false;} hcEl.classList.remove('on'); }
  function stopHand(msg){
    handOn=false; endGrab(); zoom=null; if(tr) tearEnd(); fistC=0; crumpleSources();
    if(stream){stream.getTracks().forEach(function(t){t.stop();});stream=null;}
    camEl.style.display='none'; hcEl.style.display='none'; handBtn.textContent='Hand control';
    stat.textContent=msg||'Hand control is off.';
  }
  async function startHand(){
    stat.textContent='Starting camera\u2026';
    try{
      stream=await navigator.mediaDevices.getUserMedia({video:{width:640,height:480,facingMode:'user'},audio:false});
      vid.srcObject=stream; await vid.play();
    }catch(err){ stopHand('Camera is blocked here. Allow camera access, or open the downloaded file locally.'); return; }
    try{
      if(!landmarker){
        stat.textContent='Loading hand model\u2026';
        var v=await import(/* @vite-ignore */ BASE+'/vision_bundle.mjs');
        var fs=await v.FilesetResolver.forVisionTasks(BASE+'/wasm');
        try{ landmarker=await v.HandLandmarker.createFromOptions(fs,{baseOptions:{modelAssetPath:MODEL,delegate:'GPU'},runningMode:'VIDEO',numHands:2}); }
        catch(e1){ landmarker=await v.HandLandmarker.createFromOptions(fs,{baseOptions:{modelAssetPath:MODEL,delegate:'CPU'},runningMode:'VIDEO',numHands:2}); }
      }
    }catch(err){ stopHand('The hand model could not load in this view (network access is blocked). Open the downloaded file locally to use hand control.'); return; }
    handOn=true; camEl.style.display='block'; handBtn.textContent='Stop hand control';
    stat.textContent='Pinch thumb and index to grab and drag. Zoom: pinch with both hands and spread, or hold up two fingers and move your hand toward or away from the camera.';
    loop();
  }
  handBtn.onclick=function(){ if(handOn) stopHand(); else startHand(); };
  function dist(a,b){return Math.hypot(a.x-b.x,a.y-b.y);}
  function loop(){
    if(!handOn) return;
    if(vid.readyState>=2 && vid.currentTime!==lastT){
      lastT=vid.currentTime;
      var res=landmarker.detectForVideo(vid,performance.now());
      track(res.landmarks||[]);
    }
    requestAnimationFrame(loop);
  }
  function track(hands){
    pxx.drawImage(vid,0,0,pxc.width,pxc.height);
    var im=pxx.getImageData(0,0,pxc.width,pxc.height), dd=im.data;
    for(var q=0;q<dd.length;q+=4){var gy=0.299*dd[q]+0.587*dd[q+1]+0.114*dd[q+2]; dd[q]=dd[q+1]=dd[q+2]=gy;}
    pxx.putImageData(im,0,0);
    ovx.imageSmoothingEnabled=false;
    ovx.drawImage(pxc,0,0,ov.width,ov.height);
    hands.forEach(function(h){ ovx.fillStyle='#fff'; h.forEach(function(p){ovx.beginPath();ovx.arc(p.x*ov.width,p.y*ov.height,2.5,0,7);ovx.fill();}); });
    var mids=[], pin=[]; fistR=[9,9];
    hands.forEach(function(h,i){
      var size=dist(h[0],h[9])||0.1, d=dist(h[4],h[8])/size;
      var r4=(dist(h[0],h[8])+dist(h[0],h[12])+dist(h[0],h[16])+dist(h[0],h[20]))/(4*size); fistR[i]=r4;
      pinchS[i]=(pinchS[i]?d<0.42:d<0.28)&&r4>1.25; pin.push(pinchS[i]); // a closed fist is not a pinch
      mids.push({x:(h[4].x+h[8].x)/2,y:(h[4].y+h[8].y)/2});
    });
    var fcm=0; for(var fi=0;fi<2;fi++) fcm=Math.max(fcm,Math.min(1,Math.max(0,(1.45-fistR[fi])/0.4)));
    fistC+=(fcm-fistC)*0.45; if(fistC<0.03) fistC=0; crumpleSources(); // fist closed = crumple, hand open = paper opens again
    if(hands.length>=2 && pin[0] && pin[1]){
      if(tearOn){
        var tax=(1-mids[0].x)*innerWidth,tay=mids[0].y*innerHeight,tbx=(1-mids[1].x)*innerWidth,tby=mids[1].y*innerHeight;
        if(down) endGrab(); hcEl.style.display='none';
        if(!tr) tearStart(tax,tay,tbx,tby); else tearMove(tax,tay,tbx,tby);
        return;
      }
      endGrab();
      var d2=dist(mids[0],mids[1]);
      if(!zoom) zoom={d:d2,cam:camZT};
      camZT=Math.max(ZMIN,Math.min(ZMAX,zoom.cam*Math.pow(zoom.d/Math.max(d2,0.02),1.8)));
      hcEl.style.display='none'; return;
    }
    zoom=null; if(tr) tearEnd();
    // one-hand zoom: peace sign, push toward camera = zoom in, pull back = zoom out
    var zp=false, sz0=0.1;
    if(hands.length){
      var hz=hands[0]; sz0=dist(hz[0],hz[9])||0.1;
      var rr=function(i){return dist(hz[0],hz[i])/sz0;};
      zp=!pin[0] && rr(8)>1.5 && rr(12)>1.5 && rr(16)<1.3 && rr(20)<1.3;
    }
    zCnt=zp?Math.min(zCnt+1,6):0;
    if(zCnt>=4){
      endGrab();
      if(!zref){zref={s:sz0,cam:camZT};zs=sz0;}
      zs+=(sz0-zs)*0.35;
      camZT=Math.max(ZMIN,Math.min(ZMAX,zref.cam*Math.pow(zref.s/zs,2.2)));
      var px=(1-hands[0][9].x)*innerWidth, py=hands[0][9].y*innerHeight;
      if(hcEl.style.display!=='block'){sx=px;sy=py;}
      sx+=(px-sx)*0.5; sy+=(py-sy)*0.5;
      hcEl.style.display='block'; hcEl.style.left=sx+'px'; hcEl.style.top=sy+'px';
      hcEl.setAttribute('data-l',zs>zref.s?'zoom in':'zoom out');
      return;
    }
    zref=null; hcEl.removeAttribute('data-l');
    if(!hands.length){ endGrab(); hcEl.style.display='none'; return; }
    var x=(1-mids[0].x)*innerWidth, y=mids[0].y*innerHeight;
    if(hcEl.style.display!=='block'){sx=x;sy=y;}
    sx+=(x-sx)*0.5; sy+=(y-sy)*0.5;
    hcEl.style.display='block'; hcEl.style.left=sx+'px'; hcEl.style.top=sy+'px';
    if(pin[0]){
      hcEl.classList.add('on');
      if(!down){down=true;fire('pointerdown',sx,sy);} else fire('pointermove',sx,sy);
    } else endGrab();
  }

  var zoomEl=document.getElementById('zoomS'), zoomOut=document.getElementById('vZoom');
  zoomEl.addEventListener('input',function(){ camZT=ZMAX*Math.pow(ZMIN/ZMAX,+zoomEl.value); });
  function syncZoom(){
    if(document.activeElement===zoomEl) { zoomEl.style.setProperty('--p',zoomEl.value*100+'%'); zoomOut.textContent=Math.round(8.5/camZ*100)+'%'; return; }
    var v=Math.log(camZ/ZMAX)/Math.log(ZMIN/ZMAX); v=Math.max(0,Math.min(1,v));
    zoomEl.value=v; zoomEl.style.setProperty('--p',v*100+'%'); zoomOut.textContent=Math.round(8.5/camZ*100)+'%';
  }
  // two-finger pinch zoom on touch screens
  var tp={}, pd0=1, pz0=1;
  function tpd(){var k=Object.keys(tp);return Math.hypot(tp[k[0]].x-tp[k[1]].x,tp[k[0]].y-tp[k[1]].y);}
  canvas.addEventListener('pointerdown',function(e){
    if(e.pointerType!=='touch') return; tp[e.pointerId]={x:e.clientX,y:e.clientY};
    if(Object.keys(tp).length===2){ if(mode==='bend'&&sheet)sheet.release(); mode=null; pd0=Math.max(tpd(),10); pz0=camZT; }
  });
  canvas.addEventListener('pointermove',function(e){
    if(!tp[e.pointerId]) return; tp[e.pointerId]={x:e.clientX,y:e.clientY};
    if(Object.keys(tp).length===2) camZT=Math.max(ZMIN,Math.min(ZMAX,pz0*pd0/Math.max(tpd(),10)));
  });
  function tpUp(e){delete tp[e.pointerId];}
  canvas.addEventListener('pointerup',tpUp); canvas.addEventListener('pointercancel',tpUp);

  function resize(){
    var w=stage.clientWidth,h=stage.clientHeight; renderer.setSize(w,h,false);
    camera.aspect=w/h; camera.updateProjectionMatrix();
  }
  window.addEventListener('resize',resize); resize();


  // ---- paper shredder: threads, gravity, pile on the canvas floor ----
  var shred=null, tanHalf=Math.tan(camera.fov*Math.PI/360);
  var shredBtn=document.getElementById('shred');
  var stripMat=new THREE.ShaderMaterial({uniforms:uniforms,side:THREE.DoubleSide,extensions:{derivatives:true},fragmentShader:frag,vertexShader:[
    'varying vec2 vUv; varying vec3 vWPos; varying vec3 vN;',
    'void main(){ vUv=uv; vN=normalize(mat3(modelMatrix)*normal); vWPos=(modelMatrix*vec4(position,1.0)).xyz;',
    '  gl_Position=projectionMatrix*viewMatrix*vec4(vWPos,1.0); }'].join('\n')});
  var T1=1.1, NN=14;
  function startShred(){
    group.updateMatrixWorld(true);
    var N=Math.max(24,Math.min(60,Math.round(W*14))), L=H/(NN-1), sw=W/N;
    var bW=new THREE.Vector3(1,0,0).transformDirection(poster.matrixWorld);
    poster.visible=false; flameMesh.visible=false; shadow.visible=false;
    var strips=[];
    for(var i=0;i<N;i++){
      var g=new THREE.BufferGeometry(), uvA=new Float32Array(NN*4), idx=[];
      for(var k=0;k<NN;k++){ var v=1-k/(NN-1); uvA[k*4]=i/N; uvA[k*4+1]=v; uvA[k*4+2]=(i+1)/N; uvA[k*4+3]=v; }
      for(var k2=0;k2<NN-1;k2++){ var a=2*k2; idx.push(a,a+2,a+1,a+1,a+2,a+3); }
      g.setAttribute('position',new THREE.BufferAttribute(new Float32Array(NN*6),3));
      g.setAttribute('normal',new THREE.BufferAttribute(new Float32Array(NN*6),3));
      g.setAttribute('uv',new THREE.BufferAttribute(uvA,2)); g.setIndex(idx);
      var m=new THREE.Mesh(g,stripMat); m.frustumCulled=false; scene.add(m);
      var p=[],q=[]; for(var k3=0;k3<NN;k3++){p.push(new THREE.Vector3());q.push(new THREE.Vector3());}
      strips.push({m:m,g:g,i:i,cx:-W/2+sw*(i+0.5),p:p,q:q,delay:Math.random()*0.7,rel:false,theta:0,omega:0,r:0.008+Math.random()*0.09,z0:(Math.random()-0.5)*0.9});
    }
    shred={t:0,strips:strips,L:L,sw:sw,bW:bW};
    shredBtn.textContent='Restore poster';
  }
  function restoreShred(){
    if(!shred) return;
    shred.strips.forEach(function(st){scene.remove(st.m);st.g.dispose();});
    shred=null; poster.visible=true; flameMesh.visible=true; shadow.visible=true;
    shredBtn.textContent='Shred poster';
  }
  document.getElementById('fold').onclick=startFold; document.getElementById('unfold').onclick=startUnfold; foldBtns();
  document.getElementById('crStyle').onclick=function(){ crStyle=(crStyle+1)%CR_STYLES.length; this.textContent='Crease style: '+CR_STYLES[crStyle]; crShape=null; crumpleLast=-1; };
  document.getElementById('crRand').onclick=function(){
    crStyle=Math.floor(Math.random()*CR_STYLES.length); document.getElementById('crStyle').textContent='Crease style: '+CR_STYLES[crStyle];
    crShape=null; crumpleLast=-1; var ce=document.getElementById('crumple'); ce.value=0.55+Math.random()*0.45; ce.dispatchEvent(new Event('input'));
  };
  bind('crumple','vCr',function(v){return Math.round(v*100)+'%'},function(v){crumpleV=v;});
  document.getElementById('flatten').onclick=function(){ if(sheet) sheet.smooth(); crumpleC=0; var ce=document.getElementById('crumple'); ce.value=0; ce.dispatchEvent(new Event('input')); };
  shredBtn.onclick=function(){ if(shred) restoreShred(); else startShred(); };
  var _v=new THREE.Vector3(), _d=new THREE.Vector3();
  function updateShred(dt){
    group.updateMatrixWorld(true);
    var s=shred, t=(s.t+=dt), L=s.L, sw=s.sw;
    var sy=-H/2+Math.min(1,t/T1)*H*1.08;
    var tn=uniforms.uTime.value;
    s.strips.forEach(function(st){
      var p=st.p,q=st.q,k;
      if(!st.rel){
        if(t>T1+st.delay){
          st.rel=true;
          var vx=(Math.random()-0.5)*0.5, vz=(Math.random()-0.5)*0.4;
          for(k=0;k<NN;k++){ var f=k/NN; q[k].set(p[k].x-vx*f*0.016,p[k].y,p[k].z-vz*f*0.016); }
        } else {
          for(k=0;k<NN;k++){
            var ly=H/2-k*L, e=ly<sy?Math.min(1,(sy-ly)/0.9):0; e=e*e*(3-2*e);
            simPt(st.cx*(1+0.14*e), ly, _po, Math.sin(tn*4+st.i*0.8)*0.05*e*(k/NN)); _v.set(_po.x,_po.y,_po.z);
            p[k].copy(poster.localToWorld(_v)); q[k].copy(p[k]);
          }
        }
      }
      if(st.rel){
        var steps=Math.min(4,Math.max(1,Math.round(dt*120))), h=1/120;
        for(var n=0;n<steps;n++){
          for(k=0;k<NN;k++){
            var P=p[k],Q=q[k], vx2=(P.x-Q.x)*0.998, vy2=(P.y-Q.y)*0.998, vz2=(P.z-Q.z)*0.998;
            Q.copy(P); P.x+=vx2; P.y+=vy2-16*h*h; P.z+=vz2+0.00035*Math.sin(tn*3+st.i*0.9)*(k/NN);
          }
          for(var it=0;it<6;it++){
            for(k=0;k<NN-1;k++){ _d.subVectors(p[k+1],p[k]); var len=_d.length()||1e-6, df=(len-L)/len*0.5; _d.multiplyScalar(df); p[k].add(_d); p[k+1].sub(_d); }
            for(k=0;k<NN-2;k++){ _d.subVectors(p[k+2],p[k]); var l2=_d.length()||1e-6, mn=1.75*L; if(l2<mn){ _d.multiplyScalar((l2-mn)/l2*0.075); p[k].add(_d); p[k+2].sub(_d); } }
            for(k=0;k<NN;k++){
              var PP=p[k], gy=-(camera.position.z-PP.z)*tanHalf+st.r;
              if(PP.y<gy){ PP.y=gy; q[k].y=gy; q[k].x+=(PP.x-q[k].x)*0.35; q[k].z+=(PP.z-q[k].z)*0.35; PP.z+=(st.z0-PP.z)*0.02; }
              if(PP.z>1.2)PP.z=1.2; if(PP.z<-1.2)PP.z=-1.2;
            }
          }
        }
        st.theta+=st.omega*dt; st.omega*=Math.pow(0.4,dt);
      }
      var pos=st.g.attributes.position.array, c=Math.cos(st.theta), sn=Math.sin(st.theta);
      var bx=s.bW.x*c+s.bW.z*sn, bz=-s.bW.x*sn+s.bW.z*c, by=s.bW.y;
      for(k=0;k<NN;k++){
        var a0=p[Math.max(0,k-1)], a1=p[Math.min(NN-1,k+1)];
        var tx=a1.x-a0.x, ty=a1.y-a0.y, tz=a1.z-a0.z, tl=Math.hypot(tx,ty,tz)||1; tx/=tl; ty/=tl; tz/=tl;
        var dd=bx*tx+by*ty+bz*tz, sx=bx-tx*dd, sy2=by-ty*dd, sz=bz-tz*dd, sl=Math.hypot(sx,sy2,sz);
        if(sl<0.2){ sx=ty*0-tz*0+tz; sy2=0; sz=-tx; sl=Math.hypot(sx,sz)||1; }
        sx=sx/sl*sw/2; sy2=sy2/sl*sw/2; sz=sz/sl*sw/2;
        pos[k*6]=p[k].x-sx; pos[k*6+1]=p[k].y-sy2; pos[k*6+2]=p[k].z-sz;
        pos[k*6+3]=p[k].x+sx; pos[k*6+4]=p[k].y+sy2; pos[k*6+5]=p[k].z+sz;
      }
      st.g.attributes.position.needsUpdate=true; st.g.computeVertexNormals();
    });
  }

  // ---- ripping mode controls ----
  var ripBtn=document.getElementById('rip'), ripRing=document.getElementById('ripRing'), ripPX=-1, ripPY=-1;
  function ripRingUpdate(){
    if(!ripOn||ripPX<0){ ripRing.style.display='none'; return; }
    var r=canvas.getBoundingClientRect(), dpx=2*ripRadius()*(r.height/(2*camera.position.z*tanHalf));
    ripRing.style.width=ripRing.style.height=dpx+'px'; ripRing.style.left=(ripPX-dpx/2)+'px'; ripRing.style.top=(ripPY-dpx/2)+'px'; ripRing.style.display='block';
  }
  ripBtn.onclick=function(){
    ripOn=!ripOn; ripBtn.textContent='Ripping mode: '+(ripOn?'On':'Off'); canvas.classList.toggle('rip',ripOn); ripRingUpdate();
  };
  document.getElementById('ripReset').onclick=ripRestore;
  bind('ripSize','vRip',function(v){return Math.round(v*100)+'%'},function(v){ripT=v; ripRingUpdate();});
  canvas.addEventListener('pointermove',function(e){ ripPX=e.clientX; ripPY=e.clientY; ripRingUpdate(); });
  canvas.addEventListener('pointerleave',function(){ ripPX=-1; ripRingUpdate(); });

  // ---- spray mode controls ----
  var sprayBtn=document.getElementById('spray'), sprayRing=document.getElementById('sprayRing'), spRX=-1, spRY=-1;
  var palCols=['#ff2d6f','#ff3b1f','#ffb400','#f5f500','#25e05a','#18c8ff','#2b5bff','#9b3bff','#ffffff','#000000'], sprayPal=document.getElementById('sprayPal'), sprayCol=document.getElementById('sprayCol'), swatches=[];
  function sprayRingUpdate(){
    if(!sprayOn||spRX<0){ sprayRing.style.display='none'; return; }
    var r=canvas.getBoundingClientRect(), dpx=2*sprayRadius()*(r.height/(2*camera.position.z*tanHalf));
    sprayRing.style.width=sprayRing.style.height=dpx+'px'; sprayRing.style.left=(spRX-dpx/2)+'px'; sprayRing.style.top=(spRY-dpx/2)+'px';
    sprayRing.style.borderColor='rgb('+sprayRGB.join(',')+')'; sprayRing.style.display='block';
  }
  function setSpray(on){ sprayOn=on; sprayBtn.textContent='Spray mode: '+(on?'On':'Off'); canvas.classList.toggle('spray',on); if(!on) sprayDown=false; sprayRingUpdate(); }
  var ripToggle=ripBtn.onclick; ripBtn.onclick=function(){ if(!ripOn&&sprayOn) setSpray(false); ripToggle(); }; // ripping and spraying never run together
  sprayBtn.onclick=function(){ if(!sprayOn&&ripOn) ripBtn.onclick(); setSpray(!sprayOn); };
  function setSprayColor(hex){
    sprayRGB=[parseInt(hex.substr(1,2),16),parseInt(hex.substr(3,2),16),parseInt(hex.substr(5,2),16)]; sprayCol.value=hex;
    swatches.forEach(function(b){ var on=b.dataset.c===hex; b.style.borderColor=on?'#fff':'rgba(255,255,255,.3)'; b.style.transform=on?'scale(1.18)':'none'; });
    sprayRingUpdate();
  }
  palCols.forEach(function(c){
    var b=document.createElement('button'); b.dataset.c=c; b.title=c; b.setAttribute('aria-label','Spray color '+c);
    b.style.cssText='flex:none;width:22px;height:22px;padding:0;border-radius:50%;background:'+c+';border:2px solid rgba(255,255,255,.3)';
    b.onclick=function(){ setSprayColor(c); }; sprayPal.appendChild(b); swatches.push(b);
  });
  sprayCol.addEventListener('input',function(){ setSprayColor(sprayCol.value.toLowerCase()); });
  setSprayColor('#ff2d6f');
  document.getElementById('sprayClear').onclick=sprayClear;
  bind('sprayR','vSpR',function(v){return Math.round(v*100)+'%'},function(v){sprayT=v; sprayRingUpdate();});
  bind('sprayDrip','vDr',function(v){return Math.round(v*100)+'%'},function(v){sprayDripAmt=v;});
  canvas.addEventListener('pointermove',function(e){ spRX=e.clientX; spRY=e.clientY; sprayRingUpdate(); });
  canvas.addEventListener('pointerleave',function(){ spRX=-1; sprayRingUpdate(); });

  // ---- flame mode controls ----
  var burnBtn=document.getElementById('burn'), burnRing=document.getElementById('burnRing'), bRX=-1, bRY=-1;
  function burnRingUpdate(){
    if(!burnOn||bRX<0){ burnRing.style.display='none'; return; }
    var r=canvas.getBoundingClientRect(), dpx=2*burnRadius()*(r.height/(2*camera.position.z*tanHalf));
    burnRing.style.width=burnRing.style.height=dpx+'px'; burnRing.style.left=(bRX-dpx/2)+'px'; burnRing.style.top=(bRY-dpx/2)+'px'; burnRing.style.display='block';
  }
  function setBurn(on){ burnOn=on; burnBtn.textContent='Flame mode: '+(on?'On':'Off'); canvas.classList.toggle('burn',on); if(!on) burnDown=false; burnRingUpdate(); }
  var ripToggle2=ripBtn.onclick; ripBtn.onclick=function(){ if(!ripOn&&burnOn) setBurn(false); ripToggle2(); };
  var sprayToggle2=sprayBtn.onclick; sprayBtn.onclick=function(){ if(!sprayOn&&burnOn) setBurn(false); sprayToggle2(); };
  burnBtn.onclick=function(){ if(!burnOn){ if(ripOn) ripBtn.onclick(); if(sprayOn) setSpray(false); } setBurn(!burnOn); };
  document.getElementById('burnReset').onclick=burnReset;
  bind('burnR','vBnR',function(v){return Math.round(v*100)+'%'},function(v){burnT=v; burnRingUpdate();});
  bind('burnS','vBnS',function(v){return Math.round(v*100)+'%'},function(v){burnSpread=v;});
  canvas.addEventListener('pointermove',function(e){ bRX=e.clientX; bRY=e.clientY; burnRingUpdate(); });
  canvas.addEventListener('pointerleave',function(){ bRX=-1; burnRingUpdate(); });

  // ---- crumple on demand: a closed fist (hand control), or hold the button / the C key. Let go and the paper opens again ----
  var crEl=document.getElementById('crumple'), fistC=0, fistR=[9,9], holdKey=false, holdBtn2=false, crHeld=false, holdBtnEl=document.getElementById('holdCr');
  function setCrumple(v){ crEl.value=v; crEl.dispatchEvent(new Event('input')); }
  function crumpleSources(){
    var t=Math.max(fistC,(holdKey||holdBtn2)?1:0);
    if(t>0.01){ if(Math.abs(+crEl.value-t)>0.01) setCrumple(t); crHeld=true; } else if(crHeld){ setCrumple(0); crHeld=false; }
  }
  holdBtnEl.addEventListener('pointerdown',function(e){ holdBtn2=true; try{holdBtnEl.setPointerCapture(e.pointerId);}catch(x){} crumpleSources(); });
  holdBtnEl.addEventListener('pointerup',function(){ holdBtn2=false; crumpleSources(); });
  holdBtnEl.addEventListener('pointercancel',function(){ holdBtn2=false; crumpleSources(); });
  addEventListener('keydown',function(e){ if((e.key==='c'||e.key==='C')&&!e.repeat&&!e.metaKey&&!e.ctrlKey&&(document.activeElement.type||'')!=='text'){ holdKey=true; crumpleSources(); } });
  addEventListener('keyup',function(e){ if(e.key==='c'||e.key==='C'){ holdKey=false; crumpleSources(); } });

  // ---- two-hand tear: two grips pull apart, the paper splits along a ragged line, and it all springs back when you let go ----
  // hands: pinch with both hands on the paper. mouse: drag, the second grip is mirrored through the paper's centre
  var tearOn=false, tr=null, tearBtn=document.getElementById('tearBtn'), _tw=new THREE.Vector3();
  function tearScreenPt(x,y,out){ var r=canvas.getBoundingClientRect(); ndc.set((x-r.left)/r.width*2-1,-((y-r.top)/r.height)*2+1); ray.setFromCamera(ndc,camera); return ray.ray.intersectPlane(dragPlane,out); }
  function tearHit(x,y){
    var r=canvas.getBoundingClientRect(); ndc.set((x-r.left)/r.width*2-1,-((y-r.top)/r.height)*2+1); ray.setFromCamera(ndc,camera); group.updateMatrixWorld(true);
    var h=ray.intersectObject(poster); if(!h.length) return null; var u=h[0].uv;
    if(!ripPresent[Math.min(ripMH-1,Math.floor((1-u.y)*ripMH))*ripMW+Math.min(ripMW-1,Math.floor(u.x*ripMW))]) return null; return h[0];
  }
  function tearStart(ax,ay,bx,by){
    if(!sheet||!ripPresent||shred) return false;
    var ha=tearHit(ax,ay),hb=tearHit(bx,by); if(!ha||!hb) return false;
    camera.getWorldDirection(dirV); dragPlane.setFromNormalAndCoplanarPoint(dirV,ha.point);
    var wb=new THREE.Vector3(); tearScreenPt(bx,by,wb);
    var p=poster.worldToLocal(ha.point.clone()); sheet.doGrab(sheet.near(ha.uv.x*W,(1-ha.uv.y)*H,0.2*uniforms.uRadius.value),[p.x,p.y,p.z]);
    tr={uvA:ha.uv.clone(),uvB:hb.uv.clone(),wB0:wb,sep0:Math.hypot(ax-bx,ay-by),sc:null,failed:false,pa:[ax,ay],pb:[bx,by],mouse:false,C:null};
    return true;
  }
  function tearSplit(ax,ay,bx,by){
    var n=ripMW*ripMH, sh=new Uint8Array(n), a=tr.uvA, b=tr.uvB, S0=Math.min(ripMW,ripMH), i, x, y;
    var mx=(a.x+b.x)/2*ripMW, my=(1-(a.y+b.y)/2)*ripMH, dx=bx-ax, dy=by-ay, L=Math.hypot(dx,dy)||1; dx/=L; dy/=L;
    var amp=0.045*S0, p1=Math.random()*6.28, p2=Math.random()*6.28, p3=Math.random()*6.28, p4=Math.random()*6.28, R=Math.ceil(Math.hypot(ripMW,ripMH)), jag=new Float32Array(2*R+2), t;
    for(i=0;i<jag.length;i++){ t=i-R; jag[i]=amp*(0.9*Math.sin(t/(0.13*S0)+p1)+0.5*Math.sin(t/(0.05*S0)+p2)+0.28*Math.sin(t/(0.018*S0)+p3)+0.15*Math.sin(t/(0.007*S0)+p4)); } // a ragged tear line across the paper
    var P2=(fragN>0)?fragLast:null; // creased paper tears along its facet edges
    if(P2){
      var side=new Uint8Array(P2.N), kx=ripMW/P2.FW, ky=ripMH/P2.FH, fx, fy;
      for(i=0;i<P2.N;i++){ fx=P2.cx[i]*kx; fy=P2.cy[i]*ky; if((fx-mx)*dx+(fy-my)*dy>jag[Math.round((fx-mx)*(-dy)+(fy-my)*dx)+R]) side[i]=1; }
      for(y=0;y<ripMH;y++)for(x=0;x<ripMW;x++){ if(side[P2.lab[Math.min(P2.FH-1,(y/ky)|0)*P2.FW+Math.min(P2.FW-1,(x/kx)|0)]]) sh[y*ripMW+x]=1; }
    } else {
      for(y=0;y<ripMH;y++)for(x=0;x<ripMW;x++){ if((x-mx)*dx+(y-my)*dy>jag[Math.round((x-mx)*(-dy)+(y-my)*dx)+R]) sh[y*ripMW+x]=1; }
    }
    var sc=doRip(tr.uvB,sh); if(!sc){ tr.failed=true; return; }
    sc.start=sc.mesh.position.clone(); sc.qHome=sc.qBase.clone(); tr.sc=sc;
  }
  function tearMove(ax,ay,bx,by){
    if(!tr) return;
    if(!tr.mouse&&Math.hypot(ax-tr.pa[0],ay-tr.pa[1])+Math.hypot(bx-tr.pb[0],by-tr.pb[1])>Math.hypot(bx-tr.pa[0],by-tr.pa[1])+Math.hypot(ax-tr.pb[0],ay-tr.pb[1])){ var tx=ax,ty=ay; ax=bx; ay=by; bx=tx; by=ty; } // keep each hand on its own side
    tr.pa=[ax,ay]; tr.pb=[bx,by];
    if(tearScreenPt(ax,ay,_tw)){ group.updateMatrixWorld(true); var lg=poster.worldToLocal(_tw.clone()); sheet.moveGrab([lg.x,lg.y,lg.z]); }
    if(!tr.sc&&!tr.failed&&Math.hypot(ax-bx,ay-by)>tr.sep0+0.12*innerHeight) tearSplit(ax,ay,bx,by);
    if(tr.sc&&tearScreenPt(bx,by,_tw)){ var m=tr.sc.mesh,s0=tr.sc.start; m.position.x=s0.x+_tw.x-tr.wB0.x; m.position.y=s0.y+_tw.y-tr.wB0.y; }
  }
  function tearEnd(){ if(!tr) return; if(sheet) sheet.release(); if(tr.sc){ tr.sc.held=false; tr.sc.ret=true; } tr=null; }
  function scrapMerge(sc){ // the torn piece has flown back: it is part of the paper again
    var i,bin=sc.bin; for(i=0;i<bin.length;i++) if(bin[i]) ripPresent[i]=255;
    ripBlurBoth(ripPresent,sc.bb[0],sc.bb[1],sc.bb[2],sc.bb[3],ripDataA,ripDataB); ripTex.needsUpdate=true; ripTexS.needsUpdate=true;
    scene.remove(sc.mesh); sc.geo.dispose(); sc.mat.dispose(); sc.tex.dispose(); sc.texS.dispose(); scraps.splice(scraps.indexOf(sc),1); if(ripScrap===sc) ripScrap=null;
  }
  function tearMouseStart(e){
    var c=new THREE.Vector3(); poster.getWorldPosition(c); c.project(camera); var r=canvas.getBoundingClientRect(), C=[r.left+(c.x+1)/2*r.width,r.top+(1-c.y)/2*r.height];
    if(!tearStart(e.clientX,e.clientY,2*C[0]-e.clientX,2*C[1]-e.clientY)) return false; tr.mouse=true; tr.C=C; return true;
  }
  function tearMouseMove(e){ if(tr&&tr.C) tearMove(e.clientX,e.clientY,2*tr.C[0]-e.clientX,2*tr.C[1]-e.clientY); }
  tearBtn.onclick=function(){
    tearOn=!tearOn; tearBtn.textContent='Two-hand tear: '+(tearOn?'On':'Off'); canvas.classList.toggle('rip',tearOn);
    if(tearOn){ if(ripOn) ripBtn.onclick(); if(sprayOn) setSpray(false); if(burnOn) setBurn(false); } else if(tr) tearEnd();
  };
  var rb3=ripBtn.onclick; ripBtn.onclick=function(){ if(!ripOn&&tearOn) tearBtn.onclick(); rb3(); };
  var sb3=sprayBtn.onclick; sprayBtn.onclick=function(){ if(!sprayOn&&tearOn) tearBtn.onclick(); sb3(); };
  var bb3=burnBtn.onclick; burnBtn.onclick=function(){ if(!burnOn&&tearOn) tearBtn.onclick(); bb3(); };

  var clock=new THREE.Clock();
  function tick(){
    var dt=Math.min(clock.getDelta(),1/30);
    uniforms.uTime.value+=dt;
    if(!shred) stepSheet(dt);
    stepScraps(dt); stepSpray(dt); stepBurn(dt);
    rot.x+=(rotT.x-rot.x)*0.12; rot.y+=(rotT.y-rot.y)*0.12;
    var t=uniforms.uTime.value, wd=uniforms.uWind.value, gs=0.65+0.35*Math.sin(t*0.7)*Math.sin(t*0.31+1);
    group.rotation.set(rot.x+Math.sin(t*1.3)*0.025*wd*gs, rot.y+Math.sin(t*0.9)*0.06*wd*gs, Math.sin(t*1.1)*0.04*wd*gs);
    group.position.x=wd*gs*0.12*(1+Math.sin(t*0.6));
    camZ=Math.exp(Math.log(camZ)+(Math.log(camZT)-Math.log(camZ))*0.2); camera.position.z=camZ;
    // keep the depth range tight around the sheet: a 0.1..50 range leaves too little depth precision, so stacked layers z-fight
    var nr=Math.max(0.25,camZ*0.2), fr=camZ+30; if(Math.abs(nr-camera.near)>0.01||Math.abs(fr-camera.far)>0.5){camera.near=nr;camera.far=fr;camera.updateProjectionMatrix();}
    syncZoom();
    var lx=uniforms.uLightPos.value.x, ly=uniforms.uLightPos.value.y;
    shadow.position.x=-lx*0.18; shadow.position.y=-ly*0.18;
    shadow.material.opacity=0.55*Math.min(1,uniforms.uLight.value)*Math.max(0,Math.cos(rot.y))*Math.max(0,Math.cos(rot.x));
    dirL.position.copy(uniforms.uLightPos.value); dirL.intensity=uniforms.uLight.value; ambL.intensity=uniforms.uAmb.value*2;
    if(gravityOn) stepGravity(dt);
    if(spinning) models.forEach(function(m){m.children[0].rotation.y+=dt;});
    if(shred) updateShred(dt);
    renderer.render(scene,camera);
    requestAnimationFrame(tick);
  }
  tick();
})();
