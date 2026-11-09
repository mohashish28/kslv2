const KEEP=0.12;
export function Sheet(W,H){
    var nx=Math.max(10,Math.round(W*9)), ny=Math.max(12,Math.round(H*9)), X=nx+1, n=X*(ny+1), sx=W/nx, sy=H/ny, s=Math.min(sx,sy), i,j,k, S=this;
    S.W=W;S.H=H;S.nx=nx;S.ny=ny;S.n=n;S.s=s;S.R=0.27*s;S.sx=sx;S.sy=sy;
    S.u=new Float32Array(n);S.v=new Float32Array(n);S.col=new Int16Array(n);S.row=new Int16Array(n);
    S.p=new Float32Array(n*3);S.q=new Float32Array(n*3);S.nq=new Float32Array(n*3);S.w=new Float32Array(n).fill(1);
    for(j=0,i=0;j<=ny;j++)for(k=0;k<=nx;k++,i++){S.u[i]=k*sx;S.v[i]=j*sy;S.col[i]=k;S.row[i]=j;}
    S.flat();
    var id=function(a,b){return b*X+a;}, L=[];
    for(j=0;j<=ny;j++)for(k=0;k<=nx;k++){
      if(k<nx)L.push(id(k,j),id(k+1,j));
      if(j<ny)L.push(id(k,j),id(k,j+1));
      if(k<nx&&j<ny)L.push(id(k,j),id(k+1,j+1),id(k+1,j),id(k,j+1));
    }
    S.L=new Int32Array(L); S.Lr=new Float32Array(L.length/2);
    for(i=0;i<S.Lr.length;i++){var a=L[2*i],b=L[2*i+1]; S.Lr[i]=Math.hypot(S.u[a]-S.u[b],S.v[a]-S.v[b]);}
    var T=[],Tk=[],Ts=[];
    var add=function(ka,ja,kb,jb,k2,j2,kk){var a=id(ka,ja),b=id(kb,jb),c=id(k2,j2);T.push(a,c,b);Tk.push(kk);Ts.push(Math.hypot(S.u[a]-S.u[c],S.v[a]-S.v[c]));};
    var spans=[[1,1],[2,0.55],[4,0.3]];
    for(j=0;j<=ny;j++)for(k=0;k<=nx;k++){
      for(var si=0;si<3;si++){var h=spans[si][0],kk=spans[si][1];
        if(k-h>=0&&k+h<=nx)add(k-h,j,k+h,j,k,j,kk);
        if(j-h>=0&&j+h<=ny)add(k,j-h,k,j+h,k,j,kk);
      }
      if(k>=1&&j>=1&&k+1<=nx&&j+1<=ny){add(k-1,j-1,k+1,j+1,k,j,0.6);add(k+1,j-1,k-1,j+1,k,j,0.6);}
    }
    S.T=new Int32Array(T);S.Tk=new Float32Array(Tk);S.Ts=new Float32Array(Ts);
    S.Tr=new Float32Array(Tk.length);S.Tp=new Float32Array(Tk.length);
    var hs=1; while(hs<n*2) hs<<=1;
    S.hmask=hs-1;S.hstart=new Int32Array(hs+1);S.hfill=new Int32Array(hs);S.hent=new Int32Array(n);S.hkey=new Int32Array(n);
    S.grab=null;S.hold=null;S.tgt=null;S.tgtK=0.25;S.pose=null;S.poseK=0.08;
  }
  Sheet.prototype.flat=function(){
    var S=this,i; for(i=0;i<S.n;i++){S.p[3*i]=S.u[i]-S.W/2;S.p[3*i+1]=S.H/2-S.v[i];S.p[3*i+2]=0;}
    S.q.set(S.p);
  };
  Sheet.prototype.smooth=function(){this.Tr.fill(0);this.Tp.fill(0);this.tgt=null;this.pose=null;this.crumpling=false;this.flat();if(this.onSmooth)this.onSmooth();};
  Sheet.prototype.near=function(u,v,r){
    var S=this,out=[],i,bd=1e9,best=0;
    for(i=0;i<S.n;i++){var d=Math.hypot(S.u[i]-u,S.v[i]-v); if(d<=r)out.push(i); if(d<bd){bd=d;best=i;}}
    if(!out.length)out.push(best); return out;
  };
  Sheet.prototype.refreshW=function(){
    var S=this,i; S.w.fill(1); if(S.grab) for(i=0;i<S.grab.idx.length;i++) S.w[S.grab.idx[i]]=0;
  };
  Sheet.prototype.doGrab=function(idx,at){
    var S=this,off=new Float32Array(idx.length*3),c=idx[0],cd=1e9,i,a;
    for(i=0;i<idx.length;i++){
      for(a=0;a<3;a++)off[3*i+a]=S.p[3*idx[i]+a]-at[a];
      var d=Math.hypot(off[3*i],off[3*i+1],off[3*i+2]); if(d<cd){cd=d;c=idx[i];}
    }
    S.grab={idx:idx,off:off,at:at.slice(),cur:at.slice(),c:c};
    S.refreshW();
    // the far part of the sheet is held softly, like a second hand, so a pull bends it in one arc
    var uc=S.u[c],vc=S.v[c],far=1,hw=new Float32Array(S.n);
    for(i=0;i<S.n;i++)far=Math.max(far,Math.hypot(S.u[i]-uc,S.v[i]-vc));
    for(i=0;i<S.n;i++){var t=Math.min(1,Math.max(0,(Math.hypot(S.u[i]-uc,S.v[i]-vc)/far-0.45)/0.45)); hw[i]=t*t*(3-2*t);}
    S.hold={w:hw,at:S.p.slice()};
  };
  Sheet.prototype.moveGrab=function(at){if(this.grab)this.grab.at=at.slice();};
  Sheet.prototype.release=function(){
    var S=this,g=S.grab; if(!g)return;
    for(var i=0;i<g.idx.length;i++)for(var a=0;a<3;a++)S.q[3*g.idx[i]+a]=S.p[3*g.idx[i]+a];
    S.grab=null;S.hold=null;S.refreshW();
  };
  Sheet.prototype.normals=function(q){
    var S=this,nq=S.nq,nx=S.nx,ny=S.ny,X=nx+1,j,k;
    for(j=0;j<=ny;j++){var j0=Math.max(0,j-1),j1=Math.min(ny,j+1);
      for(k=0;k<=nx;k++){var k0=Math.max(0,k-1),k1=Math.min(nx,k+1);
        var r=3*(j*X+k1),l=3*(j*X+k0),dn=3*(j1*X+k),up=3*(j0*X+k);
        var ax=q[r]-q[l],ay=q[r+1]-q[l+1],az=q[r+2]-q[l+2],bx=q[dn]-q[up],by=q[dn+1]-q[up+1],bz=q[dn+2]-q[up+2];
        var x=ay*bz-az*by,y=az*bx-ax*bz,z=ax*by-ay*bx,len=Math.hypot(x,y,z)||1,o=3*(j*X+k);
        nq[o]=x/len;nq[o+1]=y/len;nq[o+2]=z/len;
      }}
  };
  Sheet.prototype.links=function(){
    var S=this,p=S.p,w=S.w,L=S.L,rest=S.Lr;
    for(var c=0,m=rest.length;c<m;c++){
      var a=L[2*c],b=L[2*c+1],wa=w[a],wb=w[b],ws=wa+wb; if(!ws)continue;
      var ia=3*a,ib=3*b,dx=p[ib]-p[ia],dy=p[ib+1]-p[ia+1],dz=p[ib+2]-p[ia+2],d=Math.sqrt(dx*dx+dy*dy+dz*dz); if(d<1e-7)continue;
      var f=(d-rest[c])/(d*ws);
      p[ia]+=dx*f*wa;p[ia+1]+=dy*f*wa;p[ia+2]+=dz*f*wa;p[ib]-=dx*f*wb;p[ib+1]-=dy*f*wb;p[ib+2]-=dz*f*wb;
    }
  };
  Sheet.prototype.bend=function(kb){
    var S=this,p=S.p,w=S.w,T=S.T,Tk=S.Tk,Tr=S.Tr,nq=S.nq;
    for(var c=0,m=Tk.length;c<m;c++){
      var a=T[3*c],i=T[3*c+1],b=T[3*c+2],Sw=w[i]+0.25*(w[a]+w[b]); if(!Sw)continue;
      var ia=3*a,ii=3*i,ib=3*b,r=Tr[c];
      var ex=p[ii]-0.5*(p[ia]+p[ib])-r*nq[ii],ey=p[ii+1]-0.5*(p[ia+1]+p[ib+1])-r*nq[ii+1],ez=p[ii+2]-0.5*(p[ia+2]+p[ib+2])-r*nq[ii+2];
      var g=kb*Tk[c]/Sw,cx=ex*g,cy=ey*g,cz=ez*g;
      p[ii]-=cx*w[i];p[ii+1]-=cy*w[i];p[ii+2]-=cz*w[i];
      p[ia]+=0.5*cx*w[a];p[ia+1]+=0.5*cy*w[a];p[ia+2]+=0.5*cz*w[a];
      p[ib]+=0.5*cx*w[b];p[ib+1]+=0.5*cy*w[b];p[ib+2]+=0.5*cz*w[b];
    }
  };
  // a bend past the yield point is remembered: the paper keeps part of its deepest fold
  Sheet.prototype.plastic=function(){
    var S=this,p=S.p,T=S.T,nq=S.nq,Tp=S.Tp,Tr=S.Tr,Ts=S.Ts;
    for(var c=0,m=S.Tk.length;c<m;c++){
      var a=3*T[3*c],i=3*T[3*c+1],b=3*T[3*c+2];
      var off=(p[i]-0.5*(p[a]+p[b]))*nq[i]+(p[i+1]-0.5*(p[a+1]+p[b+1]))*nq[i+1]+(p[i+2]-0.5*(p[a+2]+p[b+2]))*nq[i+2];
      if(Math.abs(off)>0.5*Ts[c]&&Math.abs(off)>Math.abs(Tp[c])){Tp[c]=off;Tr[c]=KEEP*off;}
    }
  };
  Sheet.prototype.tether=function(){
    var S=this,g=S.grab; if(!g)return;
    var p=S.p,w=S.w,u=S.u,v=S.v,c=g.c,ax=p[3*c],ay=p[3*c+1],az=p[3*c+2];
    for(var i=0;i<S.n;i++){
      if(!w[i])continue;
      var k=3*i,dx=p[k]-ax,dy=p[k+1]-ay,dz=p[k+2]-az,d2=dx*dx+dy*dy+dz*dz,du=u[i]-u[c],dv=v[i]-v[c],lim2=du*du+dv*dv;
      if(d2<=lim2)continue;
      var d=Math.sqrt(d2),f=(d-Math.sqrt(lim2))/d; p[k]-=dx*f;p[k+1]-=dy*f;p[k+2]-=dz*f;
    }
  };
  // layers stay 2R apart along the sheet normal, on the side they were on when the step began
  Sheet.prototype.collide=function(){
    if(this.tgt) return; // a folded pose already keeps its layers apart; colliding them as well makes the fold jitter
    var S=this,p=S.p,q=S.q,nq=S.nq,w=S.w,n=S.n,col=S.col,row=S.row,gap=2*S.R,reach=S.s*1.05,inv=1/reach,mask=S.hmask;
    var lat2=Math.pow(S.s*0.8,2),reach2=reach*reach,st=S.hstart,ent=S.hent,key=S.hkey,i,h,e;
    var hs=function(x,y,z){return((Math.imul(x,92837111)^Math.imul(y,689287499)^Math.imul(z,283923481))>>>0)&mask;};
    st.fill(0);
    for(i=0;i<n;i++){h=hs(Math.floor(p[3*i]*inv),Math.floor(p[3*i+1]*inv),Math.floor(p[3*i+2]*inv));key[i]=h;st[h+1]++;}
    for(h=0;h<mask+1;h++)st[h+1]+=st[h];
    var fa=S.hfill; fa.set(st.subarray(0,mask+1));
    for(i=0;i<n;i++)ent[fa[key[i]]++]=i;
    for(i=0;i<n;i++){
      var ia=3*i,cx=Math.floor(p[ia]*inv),cy=Math.floor(p[ia+1]*inv),cz=Math.floor(p[ia+2]*inv);
      for(var dx=-1;dx<=1;dx++)for(var dy=-1;dy<=1;dy++)for(var dz=-1;dz<=1;dz++){
        h=hs(cx+dx,cy+dy,cz+dz);
        for(e=st[h];e<st[h+1];e++){
          var j=ent[e];
          if(j<=i||(Math.abs(col[i]-col[j])<=2&&Math.abs(row[i]-row[j])<=2))continue;
          var ib=3*j,ex=p[ia]-p[ib],ey=p[ia+1]-p[ib+1],ez=p[ia+2]-p[ib+2],d2=ex*ex+ey*ey+ez*ez;
          if(d2>=reach2)continue;
          var ws=w[i]+w[j]; if(!ws)continue;
          var ai=Math.abs(ex*nq[ia]+ey*nq[ia+1]+ez*nq[ia+2]),aj=Math.abs(ex*nq[ib]+ey*nq[ib+1]+ez*nq[ib+2]),o=aj>=ai?ib:ia;
          var n0=nq[o],n1=nq[o+1],n2=nq[o+2],dn=ex*n0+ey*n1+ez*n2;
          if(d2-dn*dn>lat2)continue;
          var dn0=(q[ia]-q[ib])*n0+(q[ia+1]-q[ib+1])*n1+(q[ia+2]-q[ib+2])*n2;
          var side=Math.abs(dn0)>0.15*gap?Math.sign(dn0):(Math.sign(dn)||1), need=gap-side*dn; if(need<=0)continue;
          var f=need*side/ws;
          p[ia]+=n0*f*w[i];p[ia+1]+=n1*f*w[i];p[ia+2]+=n2*f*w[i];
          p[ib]-=n0*f*w[j];p[ib+1]-=n1*f*w[j];p[ib+2]-=n2*f*w[j];
        }
      }
    }
  };
  Sheet.prototype.step=function(dt,wind,t){
    if(this.tgt){ this.p.set(this.tgt); this.q.set(this.tgt); return; } // a folded pose is exact, so folds never jitter or fall short
    if(this.pose&&!this.grab){ // a crumpled sheet that nobody holds settles exactly onto its pose; letting links, bending and layer collisions fight the pose pull is what made deep crumples flicker
      var Zs=this,zp=Zs.p,zq=Zs.q,zt=Zs.pose,zn=Zs.n,zv=3.2*Zs.R,zv2=zv*zv,zi,zo,zx,zy,zz,zd,zf;
      for(zi=0;zi<zn;zi++){ zo=3*zi;
        zx=zt[zo]-zp[zo]; zy=zt[zo+1]-zp[zo+1]; zz=zt[zo+2]-zp[zo+2]; zd=zx*zx+zy*zy+zz*zz;
        if(zd<1e-10){ zp[zo]=zt[zo];zp[zo+1]=zt[zo+1];zp[zo+2]=zt[zo+2]; }
        else { zf=0.35; if(zd*zf*zf>zv2) zf=zv/Math.sqrt(zd); zp[zo]+=zx*zf;zp[zo+1]+=zy*zf;zp[zo+2]+=zz*zf; }
        zq[zo]=zp[zo];zq[zo+1]=zp[zo+1];zq[zo+2]=zp[zo+2];
      }
      return;
    }
    var S=this,p=S.p,q=S.q,w=S.w,n=S.n,sub=2,h=dt/sub,damp=0.965,iters=6,i,k,it,sb,g=S.grab;
    var vmax=1.6*S.R,vmax2=vmax*vmax,nq=S.nq;
    for(sb=0;sb<sub;sb++){
      for(i=0;i<n;i++){k=3*i;
        if(!w[i]){q[k]=p[k];q[k+1]=p[k+1];q[k+2]=p[k+2];continue;}
        var vx=(p[k]-q[k])*damp,vy=(p[k+1]-q[k+1])*damp,vz=(p[k+2]-q[k+2])*damp;
        q[k]=p[k];q[k+1]=p[k+1];q[k+2]=p[k+2];p[k]+=vx;p[k+1]+=vy;p[k+2]+=vz;
      }
      S.normals(q);
      if(wind>0){
        var tt=t+sb*h;
        for(i=0;i<n;i++){ if(!w[i])continue; k=3*i;
          var x=p[k],y=p[k+1],ph=x*1.6+y*0.7-tt*(1.5+2.5*wind);
          var f=wind*(0.6*Math.sin(ph)+0.3*Math.sin(x*3.1-y*1.7-tt*4.3)+0.3)*9*h*h;
          p[k]+=nq[k]*f;p[k+1]+=nq[k+1]*f;p[k+2]+=nq[k+2]*f;
        }
      }
      for(i=0;i<n;i++){k=3*i;var dx2=p[k]-q[k],dy2=p[k+1]-q[k+1],dz2=p[k+2]-q[k+2],d2=dx2*dx2+dy2*dy2+dz2*dz2;
        if(d2<=vmax2)continue; var fc=vmax/Math.sqrt(d2); p[k]=q[k]+dx2*fc;p[k+1]=q[k+1]+dy2*fc;p[k+2]=q[k+2]+dz2*fc;}
      if(S.hold){var hw=S.hold.w,at=S.hold.at;
        for(i=0;i<n;i++){var kk=hw[i]*0.06; if(!kk||!w[i])continue; for(var a=0;a<3;a++)p[3*i+a]+=(at[3*i+a]-p[3*i+a])*kk;}}
      if(g){ // the held spot follows the pointer at a paper-friendly pace
        var gx=g.at[0]-g.cur[0],gy=g.at[1]-g.cur[1],gz=g.at[2]-g.cur[2],gd=Math.hypot(gx,gy,gz),lim=0.3*S.s,gf=gd>lim?lim/gd:1;
        g.cur[0]+=gx*gf;g.cur[1]+=gy*gf;g.cur[2]+=gz*gf;
        for(i=0;i<g.idx.length;i++)for(var b=0;b<3;b++)p[3*g.idx[i]+b]=g.cur[b]+g.off[3*i+b];
      }
      S.tether();
      if(S.pose){ // creased shapes pull the paper softly, so it can still be grabbed and dragged out of them
        var pt=S.pose,kp=S.poseK;
        for(i=0;i<n;i++){ if(!w[i])continue; var o2=3*i,qx2=(pt[o2]-p[o2])*kp,qy2=(pt[o2+1]-p[o2+1])*kp,qz2=(pt[o2+2]-p[o2+2])*kp,qd2=qx2*qx2+qy2*qy2+qz2*qz2,qf2=qd2>vmax2?vmax/Math.sqrt(qd2):1;
          p[o2]+=qx2*qf2;p[o2+1]+=qy2*qf2;p[o2+2]+=qz2*qf2; }
      }
      if(S.tgt){ // pulled to the folded pose, never faster than collisions can follow
        var tg=S.tgt,kt=S.tgtK;
        for(i=0;i<n;i++){ if(!w[i])continue; var o=3*i,fx=(tg[o]-p[o])*kt,fy=(tg[o+1]-p[o+1])*kt,fz=(tg[o+2]-p[o+2])*kt,fd=fx*fx+fy*fy+fz*fz,ff=fd>vmax2?vmax/Math.sqrt(fd):1;
          p[o]+=fx*ff;p[o+1]+=fy*ff;p[o+2]+=fz*ff; }
      }
      for(it=0;it<iters;it++){
        if(it===(iters>>1))S.collide();
        S.links();S.bend(0.25);S.links();S.links();
      }
      S.tether();S.collide();
      // keep the sheet centred where it started (nothing else holds it)
      var cx=0,cy=0,cz=0; for(i=0;i<n;i++){cx+=p[3*i];cy+=p[3*i+1];cz+=p[3*i+2];} cx/=n;cy/=n;cz/=n;
      if(!g&&!S.tgt&&!S.pose)for(i=0;i<n;i++){ p[3*i]-=cx*0.05;p[3*i+1]-=cy*0.05;p[3*i+2]-=cz*0.05; }
      if(!g&&!S.tgt&&!S.pose){ // and turned to face the camera again: a small rotation toward the sheet's own right/up/normal axes
        var ax0=0,ax1=0,ax2=0,ay0=0,ay1=0,ay2=0,hw2=S.W/2,hh2=S.H/2;
        for(i=0;i<n;i++){var du=S.u[i]-hw2,dv=hh2-S.v[i],d0=p[3*i]-cx,d1=p[3*i+1]-cy,d2b=p[3*i+2]-cz;ax0+=d0*du;ax1+=d1*du;ax2+=d2b*du;ay0+=d0*dv;ay1+=d1*dv;ay2+=d2b*dv;}
        var lx=Math.hypot(ax0,ax1,ax2),ly=Math.hypot(ay0,ay1,ay2);
        if(lx>1e-6&&ly>1e-6){
          ax0/=lx;ax1/=lx;ax2/=lx;ay0/=ly;ay1/=ly;ay2/=ly;
          var nz0=ax1*ay2-ax2*ay1,nz1=ax2*ay0-ax0*ay2,nz2=ax0*ay1-ax1*ay0;
          var kr=0.05,o0=kr*(-ay2+nz1),o1=kr*(ax2-nz0),o2=kr*(-ax1+ay0);
          for(i=0;i<n;i++){var e0=p[3*i]-cx,e1=p[3*i+1]-cy,e2=p[3*i+2]-cz;
            p[3*i]+=o1*e2-o2*e1;p[3*i+1]+=o2*e0-o0*e2;p[3*i+2]+=o0*e1-o1*e0;}
        }
      }
    }
    S.plastic();
  };
