// Fragmentation model of crumpled sheets: Andrejevic, Lee, Rubinstein & Rycroft, Nat. Commun. 12:1470 (2021).
// Facet area X = Y^2 with Y ~ Gamma(shape a, scale theta) (Eqs. 9, 10), mean area s = a(a+1)/t^2 (Eq. 7b),
// a(t) = sqrt(t/tau) (Eq. 8), total crease length l(n,D) = c1 (1-D) ln(1 + c2 n / D) (Eq. 11),
// and l = (1-D) ne t / (2(a+1)) (Eq. 14). Matching Eq. 14 to Eq. 11 gives the maturity t for n crumples at compaction D.
export const TAU = 24.041, NE = 4.2, C1 = 52, C2 = 0.1;

export function mulberry32(a){ return function(){ a|=0; a=a+0x6D2B79F5|0; var t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }
function gauss(rng){ var u=1-rng(), v=rng(); return Math.sqrt(-2*Math.log(u))*Math.cos(6.283185307*v); }
export function gammaSample(k, rng){ // Marsaglia-Tsang
  if(k<1) return gammaSample(k+1,rng)*Math.pow(rng(),1/k);
  var d=k-1/3, c=1/Math.sqrt(9*d), x, v, u;
  for(;;){ do{ x=gauss(rng); v=1+c*x; }while(v<=0); v=v*v*v; u=rng();
    if(u<1-0.0331*x*x*x*x || Math.log(u)<0.5*x*x+d*(1-v+Math.log(v))) return d*v; }
}
export function ellEmpir(n, D){ return C1*(1-D)*Math.log(1+C2*n/D); }
export function solveT(n, D){
  var rhs=C1*Math.log(1+C2*n/D), lo=0.01, hi=1e5, i, t, a;
  for(i=0;i<80;i++){ t=Math.sqrt(lo*hi); a=Math.sqrt(t/TAU); if(NE*t/(2*(a+1))<rhs) lo=t; else hi=t; }
  return Math.sqrt(lo*hi);
}
export function facetStats(n, D){
  var t=solveT(n,D), a=Math.sqrt(t/TAU), s=a*(a+1)/(t*t);
  return { t:t, a:a, s:s, N:1/s, theta:1/t, ell:ellEmpir(n,D) };
}

// A flat-faceted pattern for a sheet raster FW x FH: facet areas drawn from the paper's distribution,
// laid out as a power diagram (bigger facet = bigger weight). Returns labels, centroids and a texture
// (R,G = random tilt of each flat facet, B = ridge strength along the creases).
export function makePattern(n, D, FW, FH, seed, maxN){
  var st=facetStats(n,D), N=Math.max(3,Math.min(maxN,Math.round(st.N))), rng=mulberry32(seed), i, j, k;
  var ar=new Float64Array(N), S=0;
  for(i=0;i<N;i++){ var y=gammaSample(st.a,rng)*st.theta; ar[i]=y*y; S+=ar[i]; }
  var A=FW*FH, order=Array.from({length:N},function(_,q){return q;}); for(i=0;i<N;i++) ar[i]*=A/S;
  order.sort(function(p,q){return ar[q]-ar[p];});
  var sx=new Float32Array(N), sy=new Float32Array(N), rr=new Float32Array(N), w=new Float32Array(N), placed=[];
  order.forEach(function(f){
    var r=Math.sqrt(ar[f]/Math.PI), best=-1, bx=0, by=0, tries=24;
    while(tries--){ var x=rng()*FW, yy=rng()*FH, m=1e9;
      for(var q=0;q<placed.length;q++){ var g=placed[q], d=Math.hypot(x-sx[g],yy-sy[g])-0.55*(r+rr[g]); if(d<m) m=d; }
      if(m>best){ best=m; bx=x; by=yy; } if(best>0) break; }
    sx[f]=bx; sy[f]=by; rr[f]=r; w[f]=r*r; placed.push(f);
  });
  var lab=new Uint16Array(A), px, py;
  for(py=0;py<FH;py++) for(px=0;px<FW;px++){
    var bd=1e18, bi=0; for(i=0;i<N;i++){ var dx=px-sx[i], dy=py-sy[i], d2=dx*dx+dy*dy-w[i]; if(d2<bd){ bd=d2; bi=i; } }
    lab[py*FW+px]=bi;
  }
  var cx=new Float64Array(N), cy=new Float64Array(N), cnt=new Float64Array(N);
  for(py=0;py<FH;py++) for(px=0;px<FW;px++){ var l=lab[py*FW+px]; cx[l]+=px; cy[l]+=py; cnt[l]++; }
  for(i=0;i<N;i++){ if(cnt[i]){ cx[i]/=cnt[i]; cy[i]/=cnt[i]; } else { cx[i]=sx[i]; cy[i]=sy[i]; } }
  var tx=new Float32Array(N), ty=new Float32Array(N);
  for(i=0;i<N;i++){ tx[i]=Math.max(-1,Math.min(1,gauss(rng)*0.55)); ty[i]=Math.max(-1,Math.min(1,gauss(rng)*0.55)); }
  var ridge=new Float32Array(A), tmp=new Float32Array(A);
  for(py=0;py<FH;py++) for(px=0;px<FW;px++){ var id=py*FW+px, c0=lab[id];
    if((px<FW-1&&lab[id+1]!==c0)||(py<FH-1&&lab[id+FW]!==c0)) ridge[id]=1; }
  for(py=0;py<FH;py++) for(px=0;px<FW;px++){ var s2=0; for(k=-1;k<=1;k++){ var qx=Math.min(FW-1,Math.max(0,px+k)); s2+=ridge[py*FW+qx]; } tmp[py*FW+px]=s2/2; }
  for(py=0;py<FH;py++) for(px=0;px<FW;px++){ var s3=0; for(k=-1;k<=1;k++){ var qy=Math.min(FH-1,Math.max(0,py+k)); s3+=tmp[qy*FW+px]; } ridge[py*FW+px]=Math.min(1,s3/2); }
  var data=new Uint8Array(A*4);
  for(i=0;i<A;i++){ var f=lab[i]; data[4*i]=(tx[f]*0.5+0.5)*255; data[4*i+1]=(ty[f]*0.5+0.5)*255; data[4*i+2]=ridge[i]*255; data[4*i+3]=255; }
  return { N:N, stats:st, FW:FW, FH:FH, lab:lab, cx:cx, cy:cy, ridge:ridge, data:data };
}
