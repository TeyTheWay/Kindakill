import { useEffect, useRef, useState } from 'react';

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const GW = 1280, GH = 720;
const GRAVITY = 1800;
const PLAYER_SPEED = 320;
const JUMP_FORCE = -710;
const DJUMP_FORCE = -640;
const MAX_FALL = 920;
const PW = 32, PH = 44;
const GROUND_Y = GH - 80;
const PARRY_DUR = 0.28;
const GRAPPLE_FORCE = 3000;
const GRAPPLE_RANGE = 480;
const INV_DUR = 0.5;
const BOSS_SPAWN_KILLS = 20;
const BOSS_HP = 750;

const WEAPONS = [
  { name: 'PISTOL',   cd: 0.22, dmg: 25, spd: 750, pellets: 1, spread: 0,    fuse: 0 },
  { name: 'SHOTGUN',  cd: 0.70, dmg: 16, spd: 580, pellets: 6, spread: 0.28, fuse: 0 },
  { name: 'GRENADE',  cd: 0.85, dmg: 55, spd: 380, pellets: 1, spread: 0,    fuse: 2.8 },
  { name: 'MISSILE',  cd: 1.20, dmg:100, spd: 520, pellets: 1, spread: 0,    fuse: 0 },
];
const GRENADE_RADIUS = 192;
const MISSILE_RADIUS = 640;
const GRENADE_MAX_RANGE = 1200;

// col = base colour (unused in sprite draw, but used for HP bars / debug)
// melee = attacks by touching; flying = no gravity; hes = hesitation window (s)
const ECFG: Record<string,{w:number;h:number;hp:number;spd:number;pts:number;col:string;det:number;atr:number;adm:number;acd:number;melee:boolean;flying:boolean;hes:number}> = {
  grunt:     {w:30,h:42,hp:35, spd:148,pts:50,  col:'#dd2222',det:210,atr:56, adm:14,acd:1.3, melee:true,  flying:false,hes:0.40},
  knight:    {w:34,h:46,hp:70, spd:168,pts:100, col:'#ff6600',det:260,atr:74, adm:22,acd:1.5, melee:true,  flying:false,hes:0.45},
  shotgunner:{w:28,h:38,hp:55, spd:72,  pts:100, col:'#2266ff',det:390,atr:390,adm:11,acd:2.4, melee:false, flying:false,hes:0.55},
  grenadier: {w:30,h:44,hp:75, spd:58,  pts:130, col:'#ffcc00',det:440,atr:440,adm:22,acd:4.2, melee:false, flying:false,hes:0.90},
  flyer:     {w:40,h:36,hp:55, spd:110,pts:150, col:'#ffe080',det:420,atr:420,adm:18,acd:2.2, melee:false, flying:true, hes:0.45},
};

// ─── TYPES ────────────────────────────────────────────────────────────────────
interface Vec2 { x:number; y:number; }
interface Entity { x:number;y:number;vx:number;vy:number;w:number;h:number;hp:number;maxHp:number; }
interface Platform { id:number;x:number;y:number;w:number;h:number; }

interface Player extends Entity {
  jumps:number; grounded:boolean;
  parryActive:boolean; parryTimer:number; parryFlash:number;
  weapon:number; shootCd:number;
  grapple:boolean; grappleX:number; grappleY:number; grappleOn:boolean; grappleLen:number;
  grappleTargetId:number; // -2=static, -1=boss, >=0=enemy id
  inv:number; dead:boolean; facingRight:boolean;
  sliding:boolean; slideCd:number; slideTimer:number;
}

interface Enemy extends Entity {
  id:number; type:string; stunned:number; shootCd:number;
  pts:number; dir:number; atkTimer:number; dead:boolean; grounded:boolean;
  hesTimer:number; chargeTimer:number;
}

interface Boss extends Entity {
  jumps:number; grounded:boolean;
  parryActive:boolean; parryTimer:number;
  weapon:number; shootCd:number;
  grapple:boolean; grappleX:number; grappleY:number; grappleOn:boolean;
  phase:number; atkTimer:number; facingRight:boolean;
  dashTimer:number; dashActive:boolean; dead:boolean;
}

interface Bullet extends Entity {
  id:number; fromPlayer:boolean; dmg:number;
  btype:string; fuse:number; bounced:number; shooterId:number;
}

interface Particle {
  id:number; x:number;y:number;vx:number;vy:number;
  life:number;maxLife:number;r:number;g:number;b:number;sz:number;
}

interface Blast { x:number; y:number; r:number; mr:number; t:number; }

interface GS {
  player: Player;
  enemies: Enemy[];
  boss: Boss | null;
  bullets: Bullet[];
  platforms: Platform[];
  particles: Particle[];
  blasts: Blast[];
  score: number;
  kills: number;
  totalKills: number;
  bossSpawned: boolean;
  postBoss: boolean;
  camX: number; camY: number;
  phase: string;
  nextPlatId: number;
  nextEnemyId: number;
  nextBulletId: number;
  nextParticleId: number;
  spawnTimer: number;
  worldRight: number;
  grenadeCharge: number;
  aimX: number; aimY: number;
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function aabb(ax:number,ay:number,aw:number,ah:number,bx:number,by:number,bw:number,bh:number) {
  return ax<bx+bw && ax+aw>bx && ay<by+bh && ay+ah>by;
}

function resolveVsPlat(e:Entity & {grounded?:boolean;vy:number;vx:number}, p:Platform, fromAbove=false) {
  if (!aabb(e.x,e.y,e.w,e.h,p.x,p.y,p.w,p.h)) return false;
  const ol = (e.x+e.w)-p.x, or2 = (p.x+p.w)-e.x;
  const ot = (e.y+e.h)-p.y, ob = (p.y+p.h)-e.y;
  const mn = Math.min(ol,or2,ot,ob);
  if (fromAbove && mn!==ot) return false;
  if (mn===ot && e.vy>=0) { e.y=p.y-e.h; e.vy=0; if(e.grounded!==undefined) e.grounded=true; return true; }
  if (!fromAbove) {
    if (mn===ob && e.vy<0) { e.y=p.y+p.h; e.vy=0; return true; }
    if (mn===ol) { e.x=p.x-e.w; if(e.vx>0) e.vx=0; return true; }
    if (mn===or2) { e.x=p.x+p.w; if(e.vx<0) e.vx=0; return true; }
  }
  return false;
}

function randBetween(a:number,b:number){ return a+Math.random()*(b-a); }

function spawnParticles(gs:GS,x:number,y:number,count:number,r:number,g:number,b:number,spd=200) {
  for(let i=0;i<count;i++) {
    const angle=Math.random()*Math.PI*2;
    const s=randBetween(spd*0.4,spd);
    gs.particles.push({
      id:gs.nextParticleId++,x,y,
      vx:Math.cos(angle)*s, vy:Math.sin(angle)*s,
      life:randBetween(0.3,0.7), maxLife:0.7,
      r,g,b,sz:randBetween(2,5)
    });
  }
}

function explodeGrenade(gs:GS,x:number,y:number,fromPlayer:boolean) {
  if(!gs.blasts) gs.blasts=[];
  gs.blasts.push({x,y,r:0,mr:GRENADE_RADIUS,t:1});
  spawnParticles(gs,x,y,55,255,160,30,520);
  spawnParticles(gs,x,y,28,255,220,80,320);
  spawnParticles(gs,x,y,18,220,120,20,200);
  // Ring of fire at explosion edge
  for(let i=0;i<18;i++){
    const a=i/18*Math.PI*2;
    const er=GRENADE_RADIUS*0.45;
    gs.particles.push({id:gs.nextParticleId++,x:x+Math.cos(a)*er,y:y+Math.sin(a)*er,
      vx:Math.cos(a)*240,vy:Math.sin(a)*240,life:0.55,maxLife:0.55,r:255,g:130,b:20,sz:7});
  }
  const radius=GRENADE_RADIUS;
  const checkHit=(e:Entity & {hp:number;maxHp:number})=>{
    const cx=e.x+e.w/2, cy=e.y+e.h/2;
    const dist=Math.hypot(cx-x,cy-y);
    if(dist<radius) {
      const dmg=Math.round(70*(1-dist/radius)+15);
      e.hp-=dmg;
    }
  };
  if(fromPlayer) {
    gs.enemies.forEach(e=>{ if(!e.dead) checkHit(e); });
    if(gs.boss && !gs.boss.dead) checkHit(gs.boss);
  } else {
    if(gs.player && !gs.player.dead) checkHit(gs.player);
  }
}

// ─── WORLD GENERATION ────────────────────────────────────────────────────────
function generatePlatforms(gs:GS) {
  const rightEdge=gs.worldRight;
  const playerRight=gs.player.x+GW;
  if(rightEdge>playerRight+200) return;

  const startX=rightEdge;
  let cx=startX;
  while(cx<startX+GW*1.5) {
    const gapW=randBetween(60,160);
    cx+=gapW;
    const platW=randBetween(150,320);
    const platY=randBetween(GROUND_Y-260, GROUND_Y-30);
    gs.platforms.push({id:gs.nextPlatId++,x:cx,y:platY,w:platW,h:22});
    // Sometimes add elevated small platform
    if(Math.random()<0.4) {
      gs.platforms.push({id:gs.nextPlatId++,x:cx+platW*0.3,y:platY-randBetween(90,160),w:randBetween(80,140),h:18});
    }
    cx+=platW;
  }
  gs.worldRight=cx;
}

function cleanupPlatforms(gs:GS) {
  const cutoff=gs.camX-200;
  gs.platforms=gs.platforms.filter(p=>p.x+p.w>cutoff);
}

function spawnEnemyWave(gs:GS) {
  if(gs.bossSpawned) return;
  // Weighted pool: more grunts early, mix later
  const pool=['grunt','grunt','grunt','knight','shotgunner','grenadier','grunt','knight','flyer','shotgunner','grunt','grenadier'];
  const type=pool[Math.floor(Math.random()*pool.length)];
  const cfg=ECFG[type];

  // Find platforms ahead of the player to spawn on
  const lookAheadMin=gs.player.x+GW*0.55;
  const lookAheadMax=gs.player.x+GW+320;
  const ahead=gs.platforms.filter(pl=>
    pl.y<GROUND_Y-10 &&   // not the main ground slab
    pl.x+pl.w>lookAheadMin &&
    pl.x<lookAheadMax &&
    pl.w>cfg.w+8          // wide enough to stand on
  );

  let sx:number, sy:number;
  if(ahead.length>0) {
    const plat=ahead[Math.floor(Math.random()*ahead.length)];
    sx=randBetween(plat.x+4, plat.x+plat.w-cfg.w-4);
    sy=cfg.flying ? plat.y-180 : plat.y-cfg.h;
  } else {
    sx=randBetween(lookAheadMin, lookAheadMax);
    sy=cfg.flying ? GROUND_Y-210 : GROUND_Y-cfg.h;
  }

  gs.enemies.push({
    id:gs.nextEnemyId++, type,
    x:sx, y:sy, vx:0, vy:0,
    w:cfg.w, h:cfg.h, hp:cfg.hp, maxHp:cfg.hp,
    stunned:0, shootCd:randBetween(0.4,cfg.acd),
    pts:cfg.pts, dir:1, atkTimer:0.6, dead:false, grounded:false,
    hesTimer:0, chargeTimer:0,
  });
}

function spawnBoss(gs:GS) {
  gs.bossSpawned=true;
  gs.kills=0;
  const spawnX=gs.player.x+GW*0.8;
  gs.boss={
    x:spawnX,y:GROUND_Y-PH*1.3,vx:0,vy:0,
    w:PW*1.15,h:PH*1.15,hp:BOSS_HP,maxHp:BOSS_HP,
    jumps:2,grounded:false,
    parryActive:false,parryTimer:0,
    weapon:0,shootCd:0,
    grapple:false,grappleX:0,grappleY:0,grappleOn:false,
    phase:1,atkTimer:0,facingRight:false,
    dashTimer:0,dashActive:false,dead:false,
  };
  // Giant platform for boss fight
  gs.platforms.push({id:gs.nextPlatId++,x:spawnX-200,y:GROUND_Y,w:1200,h:80});
}

// ─── BULLET SPAWNING ─────────────────────────────────────────────────────────
function spawnBullet(gs:GS,x:number,y:number,dx:number,dy:number,fromPlayer:boolean,weaponIdx:number,shooterId=-2) {
  const w=WEAPONS[weaponIdx];
  const len=Math.hypot(dx,dy)||1;
  const nx=dx/len, ny=dy/len;
  for(let i=0;i<w.pellets;i++) {
    const angle=Math.atan2(ny,nx)+(Math.random()-0.5)*w.spread;
    const bvx=Math.cos(angle)*w.spd, bvy=Math.sin(angle)*w.spd;
    gs.bullets.push({
      id:gs.nextBulletId++,
      x:x-3,y:y-3,vx:bvx,vy:bvy,w:6,h:6,
      hp:1,maxHp:1,fromPlayer,dmg:w.dmg,
      btype:weaponIdx===0?'pistol':weaponIdx===1?'shotgun':weaponIdx===2?'grenade':'missile',
      fuse:w.fuse,bounced:0,shooterId,
    });
  }
}

function spawnEnemyBullet(gs:GS,x:number,y:number,dx:number,dy:number,dmg:number,spread=0.1,shooterId=-2) {
  const len=Math.hypot(dx,dy)||1;
  const nx=dx/len, ny=dy/len;
  const angle=Math.atan2(ny,nx)+(Math.random()-0.5)*spread;
  gs.bullets.push({
    id:gs.nextBulletId++,
    x,y,vx:Math.cos(angle)*420,vy:Math.sin(angle)*420,
    w:8,h:8,hp:1,maxHp:1,fromPlayer:false,dmg,
    btype:'enemy',fuse:0,bounced:0,shooterId,
  });
}

function spawnEnemyGrenade(gs:GS,x:number,y:number,tx:number,ty:number,shooterId=-2) {
  const dx=tx-x, dy=ty-y;
  const dist=Math.hypot(dx,dy)||1;
  const flatAngle=Math.atan2(dy,dx);
  const lobAngle=flatAngle-Math.min(0.6,80/dist);
  const spd=Math.min(230+dist*0.28, 360);
  gs.bullets.push({
    id:gs.nextBulletId++,
    x,y,vx:Math.cos(lobAngle)*spd,vy:Math.sin(lobAngle)*spd,
    w:8,h:8,hp:1,maxHp:1,fromPlayer:false,dmg:22,
    btype:'grenade',fuse:3.0,bounced:0,shooterId,
  });
}

function spawnSeraphimLaser(gs:GS,x:number,y:number,tx:number,ty:number,shooterId=-2) {
  const angle=Math.atan2(ty-y,tx-x)+(Math.random()-0.5)*0.06;
  gs.bullets.push({
    id:gs.nextBulletId++,
    x,y,vx:Math.cos(angle)*920,vy:Math.sin(angle)*920,
    w:6,h:6,hp:1,maxHp:1,fromPlayer:false,dmg:20,
    btype:'laser',fuse:0,bounced:0,shooterId,
  });
}

// ─── PHYSICS HELPERS ─────────────────────────────────────────────────────────
function applyGravAndPlatforms(e:Entity & {grounded:boolean;vy:number;vx:number}, plats:Platform[], dt:number, onlyFromAbove=false) {
  e.vy+=GRAVITY*dt;
  if(e.vy>MAX_FALL) e.vy=MAX_FALL;
  e.x+=e.vx*dt;
  e.y+=e.vy*dt;
  e.grounded=false;
  for(const p of plats) resolveVsPlat(e,p,onlyFromAbove);
  // Ground
  if(e.y+e.h>GROUND_Y) { e.y=GROUND_Y-e.h; e.vy=0; e.grounded=true; }
}

function explodeMissile(gs:GS,x:number,y:number,fromPlayer:boolean) {
  if(!gs.blasts) gs.blasts=[];
  gs.blasts.push({x,y,r:0,mr:MISSILE_RADIUS,t:1});
  spawnParticles(gs,x,y,55,255,140,20,750);
  spawnParticles(gs,x,y,28,255,220,60,420);
  spawnParticles(gs,x,y,18,255,255,200,260);
  const radius=MISSILE_RADIUS;
  const checkHit=(e:Entity & {hp:number;maxHp:number})=>{
    const cx=e.x+e.w/2, cy=e.y+e.h/2;
    const dist=Math.hypot(cx-x,cy-y);
    if(dist<radius){ const dmg=Math.round(100*(1-dist/radius)+20); e.hp-=dmg; }
  };
  if(fromPlayer){
    gs.enemies.forEach(e=>{ if(!e.dead){ const cx=e.x+e.w/2,cy=e.y+e.h/2; if(Math.hypot(cx-x,cy-y)<radius) e.hp=0; } });
    if(gs.boss&&!gs.boss.dead) checkHit(gs.boss);
  } else {
    if(!gs.player.dead) checkHit(gs.player);
  }
}

function autoAim(gs:GS,fromX:number,fromY:number,dx:number,dy:number,range:number):{dx:number,dy:number} {
  const aimAngle=Math.atan2(dy,dx);
  let bestScore=0.55, bestDx=dx, bestDy=dy;
  const check=(tx:number,ty:number)=>{
    const tdx=tx-fromX, tdy=ty-fromY;
    const dist=Math.hypot(tdx,tdy);
    if(dist>range||dist<10) return;
    const diff=Math.abs(((Math.atan2(tdy,tdx)-aimAngle)+Math.PI*3)%(Math.PI*2)-Math.PI);
    const score=1-diff/Math.PI;
    if(score>bestScore){ bestScore=score; bestDx=tdx; bestDy=tdy; }
  };
  for(const e of gs.enemies){ if(!e.dead) check(e.x+e.w/2,e.y+e.h/2); }
  if(gs.boss&&!gs.boss.dead) check(gs.boss.x+gs.boss.w/2,gs.boss.y+gs.boss.h/2);
  return {dx:bestDx,dy:bestDy};
}

// ─── GAME INIT ───────────────────────────────────────────────────────────────
function initGame(): GS {
  const plats:Platform[]=[
    {id:0,x:-500,y:GROUND_Y,w:3000,h:80},
    {id:1,x:300,y:GROUND_Y-150,w:200,h:20},
    {id:2,x:600,y:GROUND_Y-220,w:160,h:20},
    {id:3,x:850,y:GROUND_Y-130,w:240,h:20},
  ];
  const player:Player={
    x:100,y:GROUND_Y-PH,vx:0,vy:0,w:PW,h:PH,hp:100,maxHp:100,
    jumps:2,grounded:false,
    parryActive:false,parryTimer:0,parryFlash:0,
    weapon:0,shootCd:0,
    grapple:false,grappleX:0,grappleY:0,grappleOn:false,grappleLen:0,grappleTargetId:-2,
    inv:0,dead:false,facingRight:true,
    sliding:false,slideCd:0,slideTimer:0,
  };
  return {
    player, enemies:[], boss:null, bullets:[], platforms:plats, particles:[], blasts:[],
    score:0, kills:0, totalKills:0, bossSpawned:false, postBoss:false,
    camX:0, camY:0,
    phase:'playing',
    nextPlatId:10, nextEnemyId:0, nextBulletId:0, nextParticleId:0,
    spawnTimer:3, worldRight:1200, grenadeCharge:0, aimX:0, aimY:0,
  };
}

// ─── MAIN GAME CANVAS ────────────────────────────────────────────────────────
export default function GameCanvas() {
  const canvasRef=useRef<HTMLCanvasElement>(null);
  const containerRef=useRef<HTMLDivElement>(null);
  const gsRef=useRef<GS>(initGame());
  const keysRef=useRef(new Set<string>());
  const prevKeysRef=useRef(new Set<string>());
  const mouseRef=useRef({x:GW/2,y:GH/2,left:false,right:false,leftClick:false,rightClick:false,grenadeChargeDur:0});
  const [hud,setHud]=useState({score:0,hp:100,weapon:0,kills:0,totalKills:0,bossHp:0,bossMaxHp:BOSS_HP,phase:'playing',bossSpawned:false});
  const [focused,setFocused]=useState(false);
  const rafRef=useRef(0);
  const lastTimeRef=useRef(0);

  useEffect(()=>{
    const canvas=canvasRef.current;
    const container=containerRef.current;
    if(!canvas||!container) return;
    canvas.width=GW; canvas.height=GH;
    const ctx=canvas.getContext('2d')!;

    // Focus the container immediately so keyboard works without clicking
    container.focus();
    setFocused(true);

    // Key events on the container div (focusable element)
    const onKeyDown=(e:KeyboardEvent)=>{
      keysRef.current.add(e.code);
      // Prevent arrow keys / space from scrolling the page
      if(['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code)) e.preventDefault();
    };
    const onKeyUp=(e:KeyboardEvent)=>{ keysRef.current.delete(e.code); };
    // Listen on both container AND window to catch all cases
    container.addEventListener('keydown',onKeyDown);
    container.addEventListener('keyup',onKeyUp);
    window.addEventListener('keydown',onKeyDown);
    window.addEventListener('keyup',onKeyUp);

    // Mouse events
    const getPos=(e:MouseEvent)=>{
      const rect=canvas.getBoundingClientRect();
      const sx=GW/rect.width, sy=GH/rect.height;
      return { x:(e.clientX-rect.left)*sx, y:(e.clientY-rect.top)*sy };
    };
    const onMouseMove=(e:MouseEvent)=>{ const p=getPos(e); mouseRef.current.x=p.x; mouseRef.current.y=p.y; };
    const onMouseDown=(e:MouseEvent)=>{
      // Refocus every time the user clicks, ensuring keyboard capture
      container.focus();
      setFocused(true);
      if(e.button===0){ mouseRef.current.left=true; mouseRef.current.leftClick=true; }
      if(e.button===2){ mouseRef.current.right=true; mouseRef.current.rightClick=true; }
      e.preventDefault();
    };
    const onMouseUp=(e:MouseEvent)=>{
      if(e.button===0) mouseRef.current.left=false;
      if(e.button===2){ mouseRef.current.right=false; }
    };
    canvas.addEventListener('mousemove',onMouseMove);
    canvas.addEventListener('mousedown',onMouseDown);
    canvas.addEventListener('mouseup',onMouseUp);
    canvas.addEventListener('contextmenu',e=>e.preventDefault());

    function gameLoop(now:number) {
      rafRef.current=requestAnimationFrame(gameLoop);
      const dt=Math.min((now-lastTimeRef.current)/1000, 0.05);
      lastTimeRef.current=now;
      if(dt===0) return;

      const gs=gsRef.current;
      const keys=keysRef.current;
      const mouse=mouseRef.current;
      const p=gs.player;

      // ── INPUT / PLAYER UPDATE ──────────────────────────────────────────
      if(gs.phase==='playing' && !p.dead) {
        // Horizontal (blocked during slide)
        const moveL=keys.has('KeyA')||keys.has('ArrowLeft');
        const moveR=keys.has('KeyD')||keys.has('ArrowRight');
        if(!p.sliding) {
          if(moveR){ p.vx=PLAYER_SPEED; p.facingRight=true; }
          else if(moveL){ p.vx=-PLAYER_SPEED; p.facingRight=false; }
          else p.vx*=0.85;
        } else {
          // Slide: override vx with boost
          p.vx=(p.facingRight?1:-1)*PLAYER_SPEED*2.4;
        }

        // Jump
        const justJump=(keys.has('Space')||keys.has('KeyW')||keys.has('ArrowUp')) && !prevKeysRef.current.has('Space') && !prevKeysRef.current.has('KeyW') && !prevKeysRef.current.has('ArrowUp');
        if(justJump && p.jumps>0) {
          p.vy = p.jumps===2 ? JUMP_FORCE : DJUMP_FORCE;
          p.jumps--;
          p.grounded=false;
        }
        if(p.grounded) p.jumps=2;

        // Parry
        const justParry=keys.has('KeyE') && !prevKeysRef.current.has('KeyE');
        if(justParry && !p.parryActive) { p.parryActive=true; p.parryTimer=PARRY_DUR; p.parryFlash=PARRY_DUR; }
        if(p.parryActive){ p.parryTimer-=dt; if(p.parryTimer<=0){ p.parryActive=false; p.parryTimer=0; } }
        if(p.parryFlash>0) p.parryFlash-=dt;

        // Slide (Q) — ground-level speed dash with brief i-frames
        if(p.slideCd>0) p.slideCd-=dt;
        const justSlide=keys.has('KeyQ') && !prevKeysRef.current.has('KeyQ');
        if(justSlide && p.grounded && !p.sliding && p.slideCd<=0) {
          p.sliding=true; p.slideTimer=0.45; p.slideCd=1.1;
          p.inv=Math.max(p.inv,0.25);
          spawnParticles(gs,p.x+p.w/2,p.y+p.h,8,180,180,200,100);
        }
        if(p.sliding) {
          p.slideTimer-=dt;
          if(p.slideTimer<=0 || !p.grounded) { p.sliding=false; p.slideTimer=0; }
        }

        // Weapon switch
        if(keys.has('Digit1')&&!prevKeysRef.current.has('Digit1')) p.weapon=0;
        if(keys.has('Digit2')&&!prevKeysRef.current.has('Digit2')) p.weapon=1;
        if(keys.has('Digit3')&&!prevKeysRef.current.has('Digit3')) p.weapon=2;
        if(keys.has('Digit4')&&!prevKeysRef.current.has('Digit4')) p.weapon=3;

        // Shoot
        if(p.shootCd>0) p.shootCd-=dt;
        const worldMouseX=mouse.x+gs.camX;
        const worldMouseY=mouse.y+gs.camY;
        gs.aimX=worldMouseX; gs.aimY=worldMouseY;
        const pcx=p.x+p.w/2, pcy=p.y+p.h/2;

        if(p.weapon===2) {
          // ── GRENADE: hold LMB to charge, release to throw ──
          if(mouse.left && p.shootCd<=0) {
            mouse.grenadeChargeDur=Math.min(mouse.grenadeChargeDur+dt, 1.5);
          }
          if(!mouse.left && mouse.grenadeChargeDur>0.06 && p.shootCd<=0) {
            const pct=mouse.grenadeChargeDur/1.5;
            const throwSpd=220+pct*480;
            const rdx=worldMouseX-pcx, rdy=worldMouseY-pcy;
            const rlen=Math.hypot(rdx,rdy)||1;
            const cdist=Math.min(rlen,GRENADE_MAX_RANGE);
            const nx2=rdx/rlen, ny2=rdy/rlen;
            const {dx:gaDx,dy:gaDy}=autoAim(gs,pcx,pcy,rdx,rdy,700);
            const gaLen=Math.hypot(gaDx,gaDy)||1;
            const mixNx=nx2*0.65+gaDx/gaLen*0.35, mixNy=ny2*0.65+gaDy/gaLen*0.35;
            const mixLen=Math.hypot(mixNx,mixNy)||1;
            gs.bullets.push({
              id:gs.nextBulletId++, x:pcx-4, y:pcy-4,
              vx:mixNx/mixLen*throwSpd*(cdist/rlen>0.01?Math.min(cdist/rlen,1):1),
              vy:mixNy/mixLen*throwSpd,
              w:8,h:8,hp:1,maxHp:1,fromPlayer:true,
              dmg:WEAPONS[2].dmg, btype:'grenade', fuse:WEAPONS[2].fuse, bounced:0, shooterId:-2,
            });
            p.shootCd=WEAPONS[2].cd;
            spawnParticles(gs,pcx,pcy,3,100,255,50,130);
            mouse.grenadeChargeDur=0;
          }
          if(!mouse.left) mouse.grenadeChargeDur=0;
          gs.grenadeCharge=mouse.grenadeChargeDur/1.5;
        } else if(p.weapon===3) {
          // ── MISSILE: one-shot, auto-homes to nearest enemy ──
          if(mouse.leftClick && p.shootCd<=0) {
            const {dx:mDx,dy:mDy}=autoAim(gs,pcx,pcy,worldMouseX-pcx,worldMouseY-pcy,1800);
            const mLen=Math.hypot(mDx,mDy)||1;
            gs.bullets.push({
              id:gs.nextBulletId++, x:pcx-5, y:pcy-5,
              vx:mDx/mLen*WEAPONS[3].spd, vy:mDy/mLen*WEAPONS[3].spd,
              w:10,h:10,hp:1,maxHp:1,fromPlayer:true,
              dmg:WEAPONS[3].dmg, btype:'missile', fuse:0, bounced:0, shooterId:-2,
            });
            p.shootCd=WEAPONS[3].cd;
            spawnParticles(gs,pcx,pcy,5,255,140,20,280);
          }
          gs.grenadeCharge=0;
        } else {
          // ── PISTOL / SHOTGUN: instant fire, pistol has soft auto-aim ──
          if(mouse.leftClick && p.shootCd<=0) {
            let sDx=worldMouseX-pcx, sDy=worldMouseY-pcy;
            if(p.weapon===0){ const {dx,dy}=autoAim(gs,pcx,pcy,sDx,sDy,600); sDx=dx; sDy=dy; }
            spawnBullet(gs,pcx,pcy,sDx,sDy,true,p.weapon);
            p.shootCd=WEAPONS[p.weapon].cd;
            spawnParticles(gs,pcx,pcy,2,255,255,100,150);
          }
          gs.grenadeCharge=0;
        }
        mouse.leftClick=false;

        // Grapple (right click — attach; hold to swing; release to let go)
        if(mouse.rightClick) {
          const wcx=p.x+p.w/2, wcy=p.y+p.h/2;
          const wmx=mouse.x+gs.camX, wmy=mouse.y+gs.camY;
          const dist=Math.hypot(wmx-wcx,wmy-wcy);
          if(dist<=GRAPPLE_RANGE && dist>20) {
            // Priority: enemies → boss → platform snap → free point
            let snapX=wmx, snapY=wmy;
            let targetId=-2;

            // Check enemies near cursor
            let bestEDist=64;
            for(const e of gs.enemies) {
              if(e.dead) continue;
              const ecx=e.x+e.w/2, ecy=e.y+e.h/2;
              const d=Math.hypot(wmx-ecx,wmy-ecy);
              if(d<bestEDist) { bestEDist=d; snapX=ecx; snapY=ecy; targetId=e.id; }
            }
            // Check boss
            if(targetId===-2 && gs.boss && !gs.boss.dead) {
              const bcx=gs.boss.x+gs.boss.w/2, bcy=gs.boss.y+gs.boss.h/2;
              if(Math.hypot(wmx-bcx,wmy-bcy)<80) { snapX=bcx; snapY=bcy; targetId=-1; }
            }
            // Platform snap if no enemy target
            if(targetId===-2) {
              for(const plat of gs.platforms) {
                if(wmx>=plat.x && wmx<=plat.x+plat.w &&
                   wmy>=plat.y-20 && wmy<=plat.y+plat.h+20) {
                  snapX=wmx; snapY=plat.y; break;
                }
              }
            }

            const ropeLen=Math.hypot(snapX-wcx,snapY-wcy);
            p.grappleX=snapX; p.grappleY=snapY;
            p.grappleLen=ropeLen;
            p.grappleTargetId=targetId;
            p.grappleOn=true; p.grapple=true;
            // Initial burst toward anchor
            const nx=(snapX-wcx)/ropeLen, ny=(snapY-wcy)/ropeLen;
            p.vx+=nx*500; p.vy+=ny*500;
            spawnParticles(gs,snapX,snapY,5,120,230,255,160);
          }
          mouse.rightClick=false;
        }
        if(!mouse.right) { p.grapple=false; p.grappleOn=false; p.grappleTargetId=-2; }

        // Track grapple target position each frame
        if(p.grappleOn && p.grapple) {
          if(p.grappleTargetId>=0) {
            const te=gs.enemies.find(e=>!e.dead&&e.id===p.grappleTargetId);
            if(te) { p.grappleX=te.x+te.w/2; p.grappleY=te.y+te.h/2; }
            else { p.grappleOn=false; }
          } else if(p.grappleTargetId===-1) {
            if(gs.boss && !gs.boss.dead) { p.grappleX=gs.boss.x+gs.boss.w/2; p.grappleY=gs.boss.y+gs.boss.h/2; }
            else { p.grappleOn=false; }
          }
        }

        // Pull grappled enemy toward player
        if(p.grappleOn && p.grapple && p.grappleTargetId>=0) {
          const pullEnemy=gs.enemies.find(e=>!e.dead&&e.id===p.grappleTargetId);
          if(pullEnemy) {
            const ptcx=p.x+p.w/2, ptcy=p.y+p.h/2;
            const edx=ptcx-(pullEnemy.x+pullEnemy.w/2), edy=ptcy-(pullEnemy.y+pullEnemy.h/2);
            const edist=Math.hypot(edx,edy)||1;
            if(edist>25){ pullEnemy.vx+=edx/edist*2600*dt; pullEnemy.vy+=edy/edist*2600*dt; }
          }
        }

        // Apply grapple — rope-constraint pendulum physics
        if(p.grappleOn && p.grapple) {
          const cx=p.x+p.w/2, cy=p.y+p.h/2;
          const dx=p.grappleX-cx, dy=p.grappleY-cy;
          const dist=Math.hypot(dx,dy);
          // Auto-release when very close to a live enemy/boss target
          const closeThresh=p.grappleTargetId>=-1 && p.grappleTargetId!=-2 ? 55 : 8;
          if(dist<closeThresh) { p.grappleOn=false; }
          else {
            const nx=dx/dist, ny=dy/dist;
            // Pull force toward anchor
            p.vx+=nx*GRAPPLE_FORCE*dt;
            p.vy+=ny*GRAPPLE_FORCE*dt;
            // Hard rope constraint: clamp to rope length, strip outward velocity
            if(dist>p.grappleLen) {
              const excess=dist-p.grappleLen;
              p.x+=nx*excess; p.y+=ny*excess;
              // Project out the velocity component pointing away from anchor
              const vDotN=p.vx*nx+p.vy*ny;
              if(vDotN<0) { p.vx-=vDotN*nx; p.vy-=vDotN*ny; }
            }
            // Speed cap while grappling
            const spd=Math.hypot(p.vx,p.vy);
            if(spd>2000){ p.vx=p.vx/spd*2000; p.vy=p.vy/spd*2000; }
          }
        }

        // Physics
        p.vy+=GRAVITY*dt;
        if(p.vy>MAX_FALL) p.vy=MAX_FALL;
        p.x+=p.vx*dt; p.y+=p.vy*dt;
        p.grounded=false;
        for(const plat of gs.platforms) resolveVsPlat(p,plat);
        if(p.y+p.h>GROUND_Y){ p.y=GROUND_Y-p.h; p.vy=0; p.grounded=true; }
        if(p.grounded) p.jumps=2;

        // Invincibility countdown
        if(p.inv>0) p.inv-=dt;
      }

      if(gs.phase==='dead' || gs.phase==='win') {
        // Restart
        if(keys.has('KeyR') && !prevKeysRef.current.has('KeyR')) {
          gsRef.current=initGame();
          prevKeysRef.current=new Set();
          return;
        }
      }

      // ── ENEMIES UPDATE ────────────────────────────────────────────────
      if(gs.phase==='playing') {
        for(const e of gs.enemies) {
          if(e.dead) continue;
          const cfg=ECFG[e.type];
          if(e.stunned>0){ e.stunned-=dt; e.vx*=0.85; }
          else {
            const px=p.x+p.w/2, py=p.y+p.h/2;
            const ex=e.x+e.w/2, ey=e.y+e.h/2;
            const dxp=px-ex, dyp=py-ey;
            const distP=Math.hypot(dxp,dyp);

            // ── HESITATION + PER-TYPE AI ─────────────────────────────────
            const inDet=distP<cfg.det;
            const inAtk=distP<cfg.atr;
            (e as unknown as Record<string,unknown>).facingRight=(dxp>0);

            if(e.type==='grunt') {
              // ── GRUNT: DIVE ATTACK ── wind-up → leap arc at player
              if(inDet) {
                if(e.chargeTimer>0) {
                  // Mid-dive: let physics carry it, don't damp vx
                  e.chargeTimer-=dt;
                } else if(inAtk && e.atkTimer<=0) {
                  e.vx*=0.65; // slow to wind up
                  if(e.hesTimer<=0) e.hesTimer=cfg.hes;
                  if(e.hesTimer>0) {
                    e.hesTimer-=dt;
                    // wind-up crouch flash
                    if(Math.floor(e.hesTimer*14)%2===0)
                      spawnParticles(gs,ex,ey+e.h*0.5,1,255,80,60,80);
                    if(e.hesTimer<=0) {
                      e.hesTimer=0;
                      if(p.parryActive){
                        e.stunned=1.2;
                        spawnParticles(gs,ex,ey,9,100,200,255,230);
                      } else {
                        // Launch dive: fast horizontal + upward arc
                        e.vx=dxp/Math.abs(dxp||1)*cfg.spd*2.6;
                        e.vy=-320;
                        e.chargeTimer=0.55;
                        e.grounded=false;
                        spawnParticles(gs,ex,ey+e.h*0.5,8,255,100,50,180);
                      }
                      e.atkTimer=cfg.acd;
                    }
                  }
                } else {
                  e.vx=dxp/Math.abs(dxp||1)*cfg.spd;
                  e.hesTimer=0;
                }
              } else {
                e.vx=e.dir*cfg.spd*0.45;
                e.hesTimer=0; e.chargeTimer=0;
              }

            } else if(e.type==='knight') {
              // ── KNIGHT: STRAIGHT SLICE DASH ── wind-up → horizontal rush
              if(inDet) {
                if(e.chargeTimer>0) {
                  // Mid-slice: keep direction, full dash speed, no friction
                  e.chargeTimer-=dt;
                  if(e.chargeTimer<=0) e.chargeTimer=0;
                } else if(inAtk && e.atkTimer<=0) {
                  e.vx*=0.3; // brake to wind up
                  if(e.hesTimer<=0) e.hesTimer=cfg.hes;
                  if(e.hesTimer>0) {
                    e.hesTimer-=dt;
                    if(Math.floor(e.hesTimer*14)%2===0)
                      spawnParticles(gs,ex,ey-e.h*0.3,2,255,200,60,100);
                    if(e.hesTimer<=0) {
                      e.hesTimer=0;
                      if(p.parryActive){
                        e.stunned=1.8;
                        spawnParticles(gs,ex,ey,9,100,200,255,230);
                      } else {
                        // Horizontal slice dash — straight line, no vy change
                        e.vx=dxp/Math.abs(dxp||1)*cfg.spd*2.8;
                        e.chargeTimer=0.22;
                        spawnParticles(gs,ex,ey,10,255,200,40,220);
                      }
                      e.atkTimer=cfg.acd;
                    }
                  }
                } else {
                  e.vx=dxp/Math.abs(dxp||1)*cfg.spd*1.12;
                  e.hesTimer=0;
                }
              } else {
                e.vx=e.dir*cfg.spd*0.45;
                e.hesTimer=0; e.chargeTimer=0;
              }

            } else if(e.type==='shotgunner') {
              // ── RANGED GUN ── keep ideal distance, shoot after hesitation
              if(inDet) {
                const ideal=190;
                if(distP>ideal+20) e.vx=dxp/Math.abs(dxp||1)*cfg.spd;
                else if(distP<ideal-25) e.vx=-dxp/Math.abs(dxp||1)*cfg.spd*0.55;
                else e.vx*=0.82;
                e.shootCd-=dt;
                if(e.shootCd<=0 && inAtk) {
                  if(e.hesTimer<=0) e.hesTimer=cfg.hes;
                  if(e.hesTimer>0) {
                    e.hesTimer-=dt;
                    if(e.hesTimer<=0) {
                      for(let i=0;i<3;i++) spawnEnemyBullet(gs,ex,ey+e.h*0.3,dxp,dyp,cfg.adm,0.18,e.id);
                      e.shootCd=cfg.acd; e.hesTimer=0;
                      spawnParticles(gs,ex,ey,5,60,120,255,150);
                    }
                  }
                }
              } else { e.vx=e.dir*cfg.spd*0.35; }

            } else if(e.type==='grenadier') {
              // ── RANGED GRENADE ── keep far distance, lob grenade after long wind-up
              if(inDet) {
                const ideal=280;
                if(distP>ideal+30) e.vx=dxp/Math.abs(dxp||1)*cfg.spd;
                else if(distP<ideal-35) e.vx=-dxp/Math.abs(dxp||1)*cfg.spd*0.6;
                else e.vx*=0.78;
                e.shootCd-=dt;
                if(e.shootCd<=0 && inAtk) {
                  if(e.hesTimer<=0) e.hesTimer=cfg.hes;
                  if(e.hesTimer>0) {
                    e.hesTimer-=dt;
                    // Visible wind-up flicker
                    if(Math.floor(e.hesTimer*10)%2===0)
                      spawnParticles(gs,ex,ey-e.h*0.5,1,255,220,50,60);
                    if(e.hesTimer<=0) {
                      spawnEnemyGrenade(gs,ex,ey-e.h*0.35,px,py,e.id);
                      e.shootCd=cfg.acd; e.hesTimer=0;
                      spawnParticles(gs,ex,ey,5,255,200,50,130);
                    }
                  }
                }
              } else { e.vx=e.dir*cfg.spd*0.3; }

            } else if(e.type==='flyer') {
              // ── SERAPHIM ── float above player, fire laser beams
              if(inDet) {
                // Keep horizontal distance ~280px from player, float above
                const ideal=280;
                if(distP>ideal+30) e.vx=dxp/Math.abs(dxp||1)*cfg.spd;
                else if(distP<ideal-30) e.vx=-dxp/Math.abs(dxp||1)*cfg.spd*0.6;
                else e.vx*=0.88;
                const targetY=p.y-160;
                e.vy+=(targetY-e.y)*3.2*dt - e.vy*0.07;
                // Shoot lasers
                e.shootCd-=dt;
                if(e.shootCd<=0 && inAtk) {
                  if(e.hesTimer<=0) e.hesTimer=cfg.hes;
                  if(e.hesTimer>0) {
                    e.hesTimer-=dt;
                    // Charge glow — flash
                    if(Math.floor(e.hesTimer*12)%2===0)
                      spawnParticles(gs,ex,ey,2,255,230,100,80);
                    if(e.hesTimer<=0) {
                      // Fire 2 laser beams
                      spawnSeraphimLaser(gs,ex,ey+e.h*0.1,px,py,e.id);
                      spawnSeraphimLaser(gs,ex,ey+e.h*0.1,px,py,e.id);
                      e.shootCd=cfg.acd; e.hesTimer=0;
                      spawnParticles(gs,ex,ey,8,255,240,120,200);
                    }
                  }
                }
              } else {
                e.vx*=0.9;
                e.vy+=(GROUND_Y-260-e.y)*1.4*dt;
              }
              e.vy=Math.max(-260,Math.min(320,e.vy));
            }

            if(e.hesTimer<0) e.hesTimer=0;
            if(e.atkTimer>0) e.atkTimer-=dt;
          }

          // Physics — flying enemies skip gravity/platform resolution
          if(ECFG[e.type]?.flying) {
            e.x+=e.vx*dt; e.y+=e.vy*dt;
            if(e.y<-120){ e.y=-120; e.vy=Math.max(0,e.vy); }
            if(e.y+e.h>GROUND_Y+80){ e.y=GROUND_Y+80-e.h; e.vy=Math.min(0,e.vy); }
          } else {
            applyGravAndPlatforms(e,gs.platforms,dt,true);
          }
          // Despawn if way behind player
          if(e.x<gs.player.x-GW*1.2) e.dead=true;
        }

        // Contact damage — all enemies damage player on touch
        if(!p.dead && p.inv<=0) {
          for(const e of gs.enemies) {
            if(e.dead) continue;
            if(aabb(e.x,e.y,e.w,e.h,p.x,p.y,p.w,p.h)) {
              const ecfg2=ECFG[e.type];
              p.hp-=ecfg2.adm*(ecfg2.melee?0.6:0.4);
              p.inv=INV_DUR;
              spawnParticles(gs,p.x+p.w/2,p.y+p.h/2,5,255,80,80,150);
              if(p.hp<=0){ p.dead=true; gs.phase='dead'; }
              break;
            }
          }
        }

        // Remove dead enemies, grant HP on kill
        for(const e of gs.enemies) {
          if(e.dead || e.hp<=0) {
            if(!e.dead){
              gs.score+=e.pts; gs.kills++; gs.totalKills++;
              spawnParticles(gs,e.x+e.w/2,e.y+e.h/2,14,200,50,50,230);
              p.hp=Math.min(p.maxHp,p.hp+20); // health on kill
            }
            e.dead=true;
          }
        }
        gs.enemies=gs.enemies.filter(e=>!e.dead);

        // Spawn new enemies
        gs.spawnTimer-=dt;
        if(gs.spawnTimer<=0 && !gs.bossSpawned) {
          const maxEnemies=gs.kills<10?6:10;
          if(gs.enemies.length<maxEnemies){ spawnEnemyWave(gs); spawnEnemyWave(gs); }
          gs.spawnTimer=randBetween(1.5,3);
        }

        // Boss spawn
        if(gs.kills>=BOSS_SPAWN_KILLS && !gs.bossSpawned) spawnBoss(gs);
      }

      // ── BOSS UPDATE ───────────────────────────────────────────────────
      const boss=gs.boss;
      if(boss && !boss.dead && gs.phase==='playing') {
        const bx=boss.x+boss.w/2, by=boss.y+boss.h/2;
        const px=p.x+p.w/2, py2=p.y+p.h/2;
        const dxp=px-bx, dyp=py2-by;
        const distP=Math.hypot(dxp,dyp);

        // Phase based on HP%
        const hpPct=boss.hp/BOSS_HP;
        boss.phase= hpPct>0.66?1: hpPct>0.33?2:3;

        boss.atkTimer-=dt;
        boss.shootCd-=dt;
        if(boss.parryActive){ boss.parryTimer-=dt; if(boss.parryTimer<=0) boss.parryActive=false; }

        // Horizontal movement toward player
        const spd=boss.phase===3?230:boss.phase===2?190:160;
        if(distP>80) boss.vx=dxp/Math.abs(dxp||1)*spd;
        else boss.vx*=0.8;
        boss.facingRight=(dxp>0);

        // Jump
        if(boss.grounded && boss.atkTimer<=0 && Math.abs(dyp)>100) {
          boss.vy=JUMP_FORCE;
          boss.jumps--;
          boss.atkTimer=randBetween(1.5,3);
        }
        if(boss.grounded) boss.jumps=2;

        // Grapple in phase 2+
        if(boss.phase>=2 && Math.random()<0.003 && !boss.grapple) {
          boss.grapple=true; boss.grappleOn=true;
          boss.grappleX=px; boss.grappleY=py2;
        }
        if(boss.grappleOn) {
          const gd=Math.hypot(boss.grappleX-bx,boss.grappleY-by);
          if(gd>30){ boss.vx+=(boss.grappleX-bx)/gd*GRAPPLE_FORCE*dt; boss.vy+=(boss.grappleY-by)/gd*GRAPPLE_FORCE*dt; }
          else boss.grappleOn=false;
        }
        if(Math.random()<0.01) { boss.grapple=false; boss.grappleOn=false; }

        // Shoot (no shotgun; pistol does 10 dmg)
        const shootCd=boss.phase===3?0.35:boss.phase===2?0.65:0.9;
        if(boss.shootCd<=0) {
          const weaponChoice=boss.phase===3?(Math.random()<0.5?0:2):boss.phase===2?(Math.random()<0.6?0:2):0;
          spawnBullet(gs,bx,by,dxp,dyp,false,weaponChoice,-1);
          if(weaponChoice===0) gs.bullets[gs.bullets.length-1].dmg=10;
          boss.shootCd=shootCd;
          spawnParticles(gs,bx,by,3,255,60,60,100);
        }

        // Parry in phase 2+
        if(boss.phase>=2 && Math.random()<0.008 && !boss.parryActive) {
          boss.parryActive=true; boss.parryTimer=PARRY_DUR;
        }

        // Physics
        boss.vy+=GRAVITY*dt;
        if(boss.vy>MAX_FALL) boss.vy=MAX_FALL;
        boss.x+=boss.vx*dt; boss.y+=boss.vy*dt;
        boss.grounded=false;
        for(const plat of gs.platforms) resolveVsPlat(boss,plat);
        if(boss.y+boss.h>GROUND_Y){ boss.y=GROUND_Y-boss.h; boss.vy=0; boss.grounded=true; }

        // Boss melee
        if(aabb(boss.x,boss.y,boss.w,boss.h,p.x,p.y,p.w,p.h)) {
          if(p.parryActive){ boss.vy=DJUMP_FORCE; boss.vx*=-2; spawnParticles(gs,bx,by,10,100,200,255,250); }
          else if(p.inv<=0){ p.hp-=12; p.inv=INV_DUR; spawnParticles(gs,px,py2,8,255,80,80,180); }
        }

        if(boss.hp<=0) {
          boss.dead=true;
          gs.score+=1000;
          gs.bossSpawned=false;
          gs.spawnTimer=4;
          gs.postBoss=true;
          p.maxHp=150; p.hp=150;
          explodeMissile(gs,bx,by,true);
          spawnParticles(gs,bx,by,40,255,215,0,420);
        }
      }

      // ── BULLETS UPDATE ────────────────────────────────────────────────
      for(const b of gs.bullets) {
        if(b.hp<=0) continue;

        // Grenade gravity
        if(b.btype==='grenade') {
          b.vy+=GRAVITY*0.55*dt;
          if(b.fuse>0){ b.fuse-=dt; }
          if(b.fuse<=0 && b.btype==='grenade') {
            explodeGrenade(gs,b.x+b.w/2,b.y+b.h/2,b.fromPlayer);
            b.hp=0; continue;
          }
        }

        // Missile homing toward nearest enemy/boss
        if(b.btype==='missile') {
          let nearDx=b.vx, nearDy=b.vy, nearDist=Infinity;
          for(const e of gs.enemies){
            if(e.dead) continue;
            const dx=e.x+e.w/2-(b.x+b.w/2), dy=e.y+e.h/2-(b.y+b.h/2);
            const d=Math.hypot(dx,dy);
            if(d<nearDist){ nearDist=d; nearDx=dx; nearDy=dy; }
          }
          if(gs.boss&&!gs.boss.dead){
            const dx=gs.boss.x+gs.boss.w/2-(b.x+b.w/2), dy=gs.boss.y+gs.boss.h/2-(b.y+b.h/2);
            if(Math.hypot(dx,dy)<nearDist){ nearDx=dx; nearDy=dy; }
          }
          const nlen=Math.hypot(nearDx,nearDy)||1;
          b.vx+=nearDx/nlen*1800*dt; b.vy+=nearDy/nlen*1800*dt;
          // Wall avoidance: push away from nearby platforms
          const mcx=b.x+b.w/2, mcy=b.y+b.h/2;
          for(const plat of gs.platforms) {
            const pcx=plat.x+plat.w/2, pcy=plat.y+plat.h/2;
            const repDx=mcx-pcx, repDy=mcy-pcy;
            const repD=Math.hypot(repDx,repDy)||1;
            const avoidRange=180;
            if(repD<avoidRange){ const f=(1-repD/avoidRange)*4000; b.vx+=repDx/repD*f*dt; b.vy+=repDy/repD*f*dt; }
          }
          const mspd=Math.hypot(b.vx,b.vy);
          if(mspd>WEAPONS[3].spd*1.5){ b.vx=b.vx/mspd*WEAPONS[3].spd*1.5; b.vy=b.vy/mspd*WEAPONS[3].spd*1.5; }
        }

        b.x+=b.vx*dt; b.y+=b.vy*dt;

        // Platform collision — grenades bounce; all other bullets are blocked
        if(b.btype==='grenade') {
          for(const plat of gs.platforms) {
            if(aabb(b.x,b.y,b.w,b.h,plat.x,plat.y,plat.w,plat.h)) {
              const prevY=b.y-b.vy*dt;
              if(prevY+b.h<=plat.y+6) {
                b.y=plat.y-b.h;
                b.vy=Math.abs(b.vy)>80?-b.vy*0.5:0;
                b.vx*=0.78;
              } else {
                b.x=b.vx>0?plat.x-b.w:plat.x+plat.w;
                b.vx*=-0.5;
              }
              b.bounced++;
              break;
            }
          }
          // Hard floor clamp — grenades never fall through the ground
          if(b.y+b.h>GROUND_Y) {
            b.y=GROUND_Y-b.h;
            b.vy=Math.abs(b.vy)>80?-b.vy*0.5:0;
            b.vx*=0.78;
          }
        } else if(b.btype==='missile') {
          // Missiles explode on platform hit
          for(const plat of gs.platforms) {
            if(aabb(b.x,b.y,b.w,b.h,plat.x,plat.y,plat.w,plat.h)) {
              explodeMissile(gs,b.x+b.w/2,b.y+b.h/2,b.fromPlayer);
              b.hp=0; break;
            }
          }
          if(b.hp<=0) continue;
        } else if(b.btype!=='laser') {
          // Regular bullets (pistol, shotgun, enemy) stop on platforms
          for(const plat of gs.platforms) {
            if(aabb(b.x,b.y,b.w,b.h,plat.x,plat.y,plat.w,plat.h)) {
              spawnParticles(gs,b.x,b.y,2,180,180,180,80);
              b.hp=0; break;
            }
          }
          if(b.hp<=0) continue;
        } else {
          // Lasers blocked by platforms
          for(const plat of gs.platforms) {
            if(aabb(b.x,b.y,b.w,b.h,plat.x,plat.y,plat.w,plat.h)) {
              spawnParticles(gs,b.x,b.y,4,255,240,120,120);
              b.hp=0; break;
            }
          }
          if(b.hp<=0) continue;
        }

        // Bullet lifetime (off screen)
        if(b.x<gs.camX-200 || b.x>gs.camX+GW+200 || b.y<-200 || b.y>GH+200) {
          if(b.btype==='missile') explodeMissile(gs,b.x+b.w/2,b.y+b.h/2,b.fromPlayer);
          b.hp=0; continue;
        }

        // Hit player
        if(!b.fromPlayer && p.hp>0 && !p.dead) {
          if(aabb(b.x,b.y,b.w,b.h,p.x,p.y,p.w,p.h)) {
            if(p.parryActive) {
              // Auto-aim deflect toward the shooter
              const bCx=b.x+b.w/2, bCy=b.y+b.h/2;
              let aimDx=-b.vx, aimDy=-b.vy;
              if(b.shooterId===-1 && gs.boss && !gs.boss.dead) {
                aimDx=gs.boss.x+gs.boss.w/2-bCx; aimDy=gs.boss.y+gs.boss.h/2-bCy;
              } else if(b.shooterId>=0) {
                const shooter=gs.enemies.find(e=>!e.dead&&e.id===b.shooterId);
                if(shooter){ aimDx=shooter.x+shooter.w/2-bCx; aimDy=shooter.y+shooter.h/2-bCy; }
                else {
                  let nd=Infinity;
                  for(const e2 of gs.enemies){ if(e2.dead) continue; const d=Math.hypot(e2.x+e2.w/2-bCx,e2.y+e2.h/2-bCy); if(d<nd){nd=d;aimDx=e2.x+e2.w/2-bCx;aimDy=e2.y+e2.h/2-bCy;} }
                  if(gs.boss&&!gs.boss.dead){ const d=Math.hypot(gs.boss.x+gs.boss.w/2-bCx,gs.boss.y+gs.boss.h/2-bCy); if(d<nd){aimDx=gs.boss.x+gs.boss.w/2-bCx;aimDy=gs.boss.y+gs.boss.h/2-bCy;} }
                }
              }
              const alen=Math.hypot(aimDx,aimDy)||1;
              const spd2=Math.hypot(b.vx,b.vy)*1.5;
              b.vx=aimDx/alen*spd2; b.vy=aimDy/alen*spd2;
              b.fromPlayer=true; b.btype='pistol';
              spawnParticles(gs,bCx,bCy,10,80,200,255,260);
            } else if(p.inv<=0) {
              p.hp-=b.dmg; p.inv=INV_DUR;
              spawnParticles(gs,p.x+p.w/2,p.y+p.h/2,5,255,80,80,150);
              b.hp=0;
            } else b.hp=0;
            if(p.hp<=0) { p.dead=true; gs.phase='dead'; }
            continue;
          }
        }

        // Hit enemies
        if(b.fromPlayer) {
          let hitSomething=false;
          for(const e of gs.enemies) {
            if(e.dead) continue;
            if(aabb(b.x,b.y,b.w,b.h,e.x,e.y,e.w,e.h)) {
              if(b.btype==='missile'){ explodeMissile(gs,b.x+b.w/2,b.y+b.h/2,true); b.hp=0; hitSomething=true; break; }
              e.hp-=b.dmg;
              spawnParticles(gs,b.x,b.y,4,200,50,50,150);
              b.hp=0; hitSomething=true;
              if(e.hp<=0){ e.dead=true; gs.score+=e.pts; gs.kills++; gs.totalKills++; p.hp=Math.min(p.maxHp,p.hp+20); spawnParticles(gs,e.x+e.w/2,e.y+e.h/2,12,200,50,50,220); }
              break;
            }
          }
          if(!hitSomething && boss && !boss.dead) {
            if(aabb(b.x,b.y,b.w,b.h,boss.x,boss.y,boss.w,boss.h)) {
              if(boss.parryActive) {
                b.vx*=-1.2; b.vy*=-1.2; b.fromPlayer=false;
                spawnParticles(gs,b.x,b.y,8,255,100,50,200);
              } else {
                if(b.btype==='missile'){ explodeMissile(gs,b.x+b.w/2,b.y+b.h/2,true); }
                else { boss.hp-=b.dmg; }
                spawnParticles(gs,b.x,b.y,5,150,50,200,150);
                b.hp=0;
              }
            }
          }
        }
      }
      gs.bullets=gs.bullets.filter(b=>b.hp>0);

      // ── PARTICLES UPDATE ──────────────────────────────────────────────
      for(const part of gs.particles) {
        part.life-=dt;
        part.x+=part.vx*dt; part.y+=part.vy*dt;
        part.vy+=500*dt;
        part.vx*=0.95;
      }
      gs.particles=gs.particles.filter(p=>p.life>0);
      // Update blast rings (guard for HMR state compat)
      if(!gs.blasts) gs.blasts=[];
      for(const bl of gs.blasts){ bl.r+=bl.mr*2.8*dt; bl.t-=dt*2.6; }
      gs.blasts=gs.blasts.filter(bl=>bl.t>0);

      // ── WORLD GEN ─────────────────────────────────────────────────────
      generatePlatforms(gs);
      cleanupPlatforms(gs);

      // ── CAMERA ───────────────────────────────────────────────────────
      const targetCamX=p.x-GW*0.35;
      const targetCamY=p.y-GH*0.5;
      gs.camX+=(targetCamX-gs.camX)*8*dt;
      gs.camY+=(targetCamY-gs.camY)*6*dt;
      if(gs.camY>GROUND_Y-GH+100) gs.camY=GROUND_Y-GH+100;
      if(gs.camY<-200) gs.camY=-200;

      // ── RENDER ───────────────────────────────────────────────────────
      render(ctx, gs);

      // ── HUD SYNC ─────────────────────────────────────────────────────
      setHud({
        score:gs.score, hp:p.hp, weapon:p.weapon,
        kills:gs.kills, totalKills:gs.totalKills, bossHp:boss?boss.hp:0, bossMaxHp:BOSS_HP,
        phase:gs.phase, bossSpawned:gs.bossSpawned,
      });

      prevKeysRef.current=new Set(keysRef.current);
    }

    lastTimeRef.current=performance.now();
    rafRef.current=requestAnimationFrame(gameLoop);

    return ()=>{
      cancelAnimationFrame(rafRef.current);
      container.removeEventListener('keydown',onKeyDown);
      container.removeEventListener('keyup',onKeyUp);
      window.removeEventListener('keydown',onKeyDown);
      window.removeEventListener('keyup',onKeyUp);
      canvas.removeEventListener('mousemove',onMouseMove);
      canvas.removeEventListener('mousedown',onMouseDown);
      canvas.removeEventListener('mouseup',onMouseUp);
    };
  },[]);

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      style={{position:'relative',width:'100vw',height:'100vh',overflow:'hidden',background:'#0a0a1a',outline:'none'}}
    >
      <canvas ref={canvasRef} style={{width:'100%',height:'100%',display:'block',cursor:'crosshair'}} />
      {/* "Click to play" hint shown until first interaction */}
      {!focused && (
        <div style={{position:'absolute',inset:0,display:'flex',alignItems:'center',justifyContent:'center',pointerEvents:'none'}}>
          <div style={{color:'#aaa',fontSize:18,border:'2px solid #555',padding:'12px 28px',borderRadius:6,background:'rgba(0,0,0,0.6)'}}>
            Click to activate controls
          </div>
        </div>
      )}

      {/* HUD */}
      <div style={{position:'absolute',top:0,left:0,right:0,bottom:0,pointerEvents:'none',fontFamily:'Courier New,monospace'}}>
        {/* Score top-left */}
        <div style={{position:'absolute',top:16,left:20,color:'#fff',fontSize:22,fontWeight:'bold',textShadow:'0 0 10px #fff'}}>
          SCORE: {hud.score.toString().padStart(7,'0')}
        </div>
        <div style={{position:'absolute',top:44,left:20,color:'#aaa',fontSize:14}}>
          KILLS: {hud.kills} {hud.bossSpawned?'':'/ '+BOSS_SPAWN_KILLS+' to boss'}
        </div>
        <div style={{position:'absolute',top:64,left:20,color:'#888',fontSize:13}}>
          TOTAL: {hud.totalKills}
        </div>

        {/* HP bar bottom-left */}
        <div style={{position:'absolute',bottom:28,left:20}}>
          <div style={{color:'#fff',fontSize:13,marginBottom:4}}>HP</div>
          <div style={{width:180,height:14,background:'#333',border:'2px solid #666',borderRadius:3}}>
            <div style={{width:`${Math.max(0,hud.hp)}%`,height:'100%',background:hud.hp>50?'#22ff44':hud.hp>25?'#ffaa00':'#ff2222',borderRadius:2,transition:'width 0.1s'}} />
          </div>
          <div style={{color:'#aaa',fontSize:12,marginTop:2}}>{Math.max(0,hud.hp)} / 100</div>
        </div>

        {/* Weapons bottom-center */}
        <div style={{position:'absolute',bottom:20,left:'50%',transform:'translateX(-50%)',display:'flex',gap:8}}>
          {WEAPONS.map((w,i)=>(
            <div key={i} style={{
              padding:'6px 14px',border:`2px solid ${hud.weapon===i?'#fff':'#555'}`,
              borderRadius:4,color:hud.weapon===i?'#fff':'#777',
              background:hud.weapon===i?'rgba(255,255,255,0.15)':'rgba(0,0,0,0.3)',
              fontSize:13,fontWeight:hud.weapon===i?'bold':'normal',
              textShadow:hud.weapon===i?'0 0 8px #fff':'none',
            }}>[{i+1}] {w.name}</div>
          ))}
        </div>

        {/* Controls hint top-right */}
        <div style={{position:'absolute',top:16,right:20,color:'#666',fontSize:12,textAlign:'right',lineHeight:1.8}}>
          WASD/ARROWS: Move | SPACE: Jump<br/>
          LMB: Shoot | RMB: Grapple<br/>
          E: Parry | Q: Slide | 1/2/3: Weapons
        </div>

        {/* Boss HP bar */}
        {hud.bossSpawned && hud.bossHp>0 && (
          <div style={{position:'absolute',top:16,left:'50%',transform:'translateX(-50%)',textAlign:'center',minWidth:340}}>
            <div style={{color:'#ff4444',fontSize:16,fontWeight:'bold',marginBottom:4,textShadow:'0 0 12px #ff0000'}}>
              ◆ MIRROR KNIGHT ◆
            </div>
            <div style={{width:340,height:16,background:'#200',border:'2px solid #f00',borderRadius:3,margin:'0 auto'}}>
              <div style={{width:`${Math.max(0,hud.bossHp/BOSS_HP*100)}%`,height:'100%',background:'linear-gradient(90deg,#800000,#ff2222)',borderRadius:2,transition:'width 0.1s'}} />
            </div>
            <div style={{color:'#ff6666',fontSize:12,marginTop:2}}>{Math.max(0,hud.bossHp)} / {BOSS_HP}</div>
          </div>
        )}

        {/* Death screen */}
        {hud.phase==='dead' && (
          <div style={{position:'absolute',inset:0,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',background:'rgba(0,0,0,0.7)'}}>
            <div style={{color:'#ff2222',fontSize:64,fontWeight:'bold',textShadow:'0 0 30px #f00',marginBottom:16}}>YOU DIED</div>
            <div style={{color:'#888',fontSize:22,marginBottom:8}}>Score: {hud.score}</div>
            <div style={{color:'#aaa',fontSize:22,marginBottom:32}}>Total Kills: {hud.totalKills}</div>
            <div style={{color:'#fff',fontSize:20,border:'2px solid #fff',padding:'10px 32px',borderRadius:4,animation:'pulse 1s infinite',textShadow:'0 0 8px #fff'}}>
              Press R to Restart
            </div>
          </div>
        )}

        {/* Win screen */}
        {hud.phase==='win' && (
          <div style={{position:'absolute',inset:0,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',background:'rgba(0,0,0,0.7)'}}>
            <div style={{color:'#ffd700',fontSize:52,fontWeight:'bold',textShadow:'0 0 30px #ffd700',marginBottom:16}}>VICTORY!</div>
            <div style={{color:'#aaa',fontSize:22,marginBottom:8}}>Mirror Knight Defeated</div>
            <div style={{color:'#fff',fontSize:26,marginBottom:8}}>Final Score: {hud.score}</div>
            <div style={{color:'#ccc',fontSize:22,marginBottom:32}}>Total Kills: {hud.totalKills}</div>
            <div style={{color:'#ffd700',fontSize:20,border:'2px solid #ffd700',padding:'10px 32px',borderRadius:4,textShadow:'0 0 8px #ffd700'}}>
              Press R to Play Again
            </div>
          </div>
        )}
      </div>

      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
      `}</style>
    </div>
  );
}

// ─── SPRITE HELPERS ──────────────────────────────────────────────────────────

// Human side-profile player with smooth walk cycle
function drawV1(ctx:CanvasRenderingContext2D, p:Player, camX:number, camY:number, now:number) {
  if(p.dead) return;
  const sx=p.x+p.w/2-camX, sy=p.y+p.h-camY;
  const isParry=p.parryActive;
  const isInv=p.inv>0;
  if(isInv && Math.floor(now/70)%2===0) return;

  const t=now*0.0095;
  const moving=Math.abs(p.vx)>20;
  const inAir=!p.grounded;
  const isSlide=p.sliding;
  // Walk cycle: smooth sinusoidal limb swing
  const legFwd=moving&&!isSlide?Math.sin(t*1.9)*18:0;
  const legBk=moving&&!isSlide?Math.sin(t*1.9+Math.PI)*18:0;
  const armFwd=moving&&!isSlide?Math.sin(t*1.9+Math.PI)*14:0;
  const armBk=moving&&!isSlide?Math.sin(t*1.9)*10:0;
  const bodyBob=moving&&!isSlide?Math.abs(Math.sin(t*1.9))*2:0;
  // Air pose — tuck legs
  const airLeg=inAir&&!isSlide?-10:0;
  const torsoLean=moving&&!isSlide?0.08:0;

  // ── Slide crouch pose — draw entirely differently ──
  if(isSlide) {
    ctx.save();
    ctx.translate(sx, sy);
    if(!p.facingRight) ctx.scale(-1,1);
    const skin2=isParry?'#c8e8ff':'#f5d0a0';
    const cloth2=isParry?'#5588cc':'#2a4a7a';
    const boot2=isParry?'#335588':'#1a1a2e';
    ctx.shadowColor='#88ccff'; ctx.shadowBlur=12;
    // Slide dust trail
    ctx.globalAlpha=0.35;
    ctx.fillStyle='#aabbcc';
    ctx.beginPath(); ctx.ellipse(-12,-4,18,5,0,0,Math.PI*2); ctx.fill();
    ctx.globalAlpha=1;
    // Body leaned forward, crouched
    ctx.save(); ctx.rotate(0.7); // strong lean
    ctx.fillStyle=cloth2;
    ctx.fillRect(-6,-30,13,22); // torso
    ctx.restore();
    // Head
    ctx.save(); ctx.rotate(0.6);
    ctx.fillStyle=skin2; ctx.fillRect(4,-40,14,14);
    ctx.fillStyle=cloth2; ctx.fillRect(4,-44,14,6);
    ctx.restore();
    // Legs (folded under)
    ctx.fillStyle=cloth2;
    ctx.fillRect(-6,-12,10,10);   // thigh
    ctx.fillRect(-4,-4,8,8);
    ctx.fillStyle=boot2;
    ctx.fillRect(-8,-6,16,7);     // boot flat on ground
    // Gun arm stretched forward
    ctx.fillStyle=cloth2;
    ctx.fillRect(6,-28,12,6);
    ctx.fillStyle='#555';
    ctx.fillRect(17,-30,12,5);
    ctx.restore();
    return;
  }

  ctx.save();
  ctx.translate(sx, sy-bodyBob);
  if(!p.facingRight) ctx.scale(-1,1);

  ctx.shadowColor=isParry?'#44aaff':'#aaddff';
  ctx.shadowBlur=isParry?20:6;

  const skin=isParry?'#c8e8ff':'#f5d0a0';
  const cloth=isParry?'#5588cc':'#2a4a7a';
  const clothDk=isParry?'#3366aa':'#162840';
  const clothLt=isParry?'#7aaae0':'#3d6099';
  const boot=isParry?'#335588':'#1a1a2e';
  const gunMetal='#444';

  // ── Back leg (behind body) ──
  ctx.save();
  ctx.translate(-3,-38);
  ctx.rotate((-legBk+airLeg)*Math.PI/180);
  ctx.fillStyle=clothDk;
  ctx.fillRect(-4,-2,7,20); // thigh
  ctx.fillRect(-3,18,6,16); // shin
  ctx.fillStyle=boot;
  ctx.fillRect(-4,32,9,6); // boot
  ctx.fillRect(3,32,5,3);  // toe
  ctx.restore();

  // ── Back arm (behind body, swings forward) ──
  ctx.save();
  ctx.translate(-4,-39);
  ctx.rotate((armBk)*Math.PI/180);
  ctx.fillStyle=clothDk;
  ctx.fillRect(-3,0,6,14); // upper arm
  ctx.fillStyle=skin;
  ctx.fillRect(-2,13,5,11); // forearm/hand
  ctx.restore();

  // ── Torso ──
  ctx.save();
  ctx.rotate(torsoLean);
  ctx.fillStyle=cloth;
  // Side-profile torso: narrow width, taller
  ctx.beginPath();
  ctx.moveTo(-7,-46); ctx.lineTo(7,-46);
  ctx.lineTo(9,-16); ctx.lineTo(-5,-16);
  ctx.closePath(); ctx.fill();
  // Jacket highlight
  ctx.fillStyle=clothLt;
  ctx.fillRect(-5,-44,4,28);
  // Belt
  ctx.fillStyle=clothDk;
  ctx.fillRect(-6,-18,15,4);
  ctx.restore();

  // ── Front leg ──
  ctx.save();
  ctx.translate(3,-38);
  ctx.rotate((legFwd+airLeg)*Math.PI/180);
  ctx.fillStyle=cloth;
  ctx.fillRect(-4,-2,7,20);
  ctx.fillStyle=clothLt;
  ctx.fillRect(-3,-2,3,20);
  ctx.fillStyle=cloth;
  ctx.fillRect(-3,18,6,16);
  ctx.fillStyle=boot;
  ctx.fillRect(-4,32,10,6);
  ctx.fillRect(4,32,5,3);
  ctx.restore();

  // ── Front arm + gun (raised toward aim direction) ──
  ctx.save();
  ctx.translate(5,-38);
  ctx.rotate((-armFwd-5)*Math.PI/180);
  ctx.fillStyle=cloth;
  ctx.fillRect(-3,0,6,14);
  ctx.fillStyle=skin;
  ctx.fillRect(-2,13,5,10);
  // Gun
  ctx.fillStyle=gunMetal;
  ctx.fillRect(3,8,20,5);   // barrel
  ctx.fillStyle='#555';
  ctx.fillRect(3,5,9,5);    // grip/slide
  ctx.fillStyle='#333';
  ctx.fillRect(21,6,4,8);   // muzzle
  if(isParry){
    ctx.fillStyle='rgba(100,180,255,0.7)';
    ctx.shadowColor='#4499ff'; ctx.shadowBlur=12;
    ctx.fillRect(0,5,26,8);
    ctx.shadowBlur=0;
  }
  ctx.restore();

  // ── Head (side profile) ──
  ctx.save();
  ctx.rotate(torsoLean*0.5);
  // Skull/hair
  ctx.fillStyle=isParry?'#334':'#1a1a1a';
  ctx.beginPath();
  ctx.ellipse(4,-56,10,11,0,0,Math.PI*2); ctx.fill();
  // Face skin
  ctx.fillStyle=skin;
  ctx.beginPath();
  ctx.ellipse(5,-55,8,9,0.1,0,Math.PI*2); ctx.fill();
  // Eye
  ctx.fillStyle='#1a1a1a';
  ctx.beginPath(); ctx.ellipse(10,-55,2.5,2,0,0,Math.PI*2); ctx.fill();
  ctx.fillStyle=isParry?'#88ccff':'#ff2222';
  ctx.shadowColor=isParry?'#88ccff':'#ff0000'; ctx.shadowBlur=8;
  ctx.beginPath(); ctx.ellipse(10,-55,1.5,1.5,0,0,Math.PI*2); ctx.fill();
  ctx.shadowBlur=0;
  // Nose bridge
  ctx.fillStyle='rgba(0,0,0,0.2)';
  ctx.fillRect(11,-58,3,4);
  // Jaw line
  ctx.fillStyle=skin;
  ctx.beginPath();
  ctx.moveTo(0,-50); ctx.lineTo(13,-50); ctx.lineTo(14,-46); ctx.lineTo(1,-46);
  ctx.closePath(); ctx.fill();
  ctx.restore();

  ctx.shadowBlur=0;
  ctx.restore();

  // ── Grapple rope ──
  if(p.grappleOn||p.grapple) {
    const gx=p.grappleX-camX, gy=p.grappleY-camY;
    const rx=p.x+p.w/2-camX, ry=sy-38;
    ctx.save();
    // Rope with slight droop (catenary approximation via quadratic)
    const midX=(rx+gx)/2, midY=(ry+gy)/2 + Math.hypot(gx-rx,gy-ry)*0.12;
    ctx.strokeStyle='rgba(120,220,255,0.92)';
    ctx.lineWidth=2;
    ctx.setLineDash([5,4]);
    ctx.lineDashOffset=-(now*0.08%9);
    ctx.beginPath();
    ctx.moveTo(rx,ry);
    ctx.quadraticCurveTo(midX,midY,gx,gy);
    ctx.stroke();
    ctx.setLineDash([]); ctx.lineDashOffset=0;
    // Anchor point
    ctx.fillStyle='#88eeff';
    ctx.shadowColor='#88eeff'; ctx.shadowBlur=10;
    ctx.beginPath(); ctx.arc(gx,gy,5,0,Math.PI*2); ctx.fill();
    // Hook
    ctx.strokeStyle='#44ccff'; ctx.lineWidth=2; ctx.shadowBlur=0;
    ctx.beginPath(); ctx.arc(gx,gy+3,4,0,Math.PI); ctx.stroke();
    ctx.shadowBlur=0;
    ctx.restore();
  }
}

// Filth (red blob with big eyes and jagged grin)
function drawFilth(ctx:CanvasRenderingContext2D, e:Enemy, camX:number, camY:number, now:number) {
  const sx=e.x+e.w/2-camX, sy=e.y+e.h-camY;
  const moving=Math.abs(e.vx)>15;
  const bounce=moving?Math.abs(Math.sin(now*0.014+e.id))*4:0;
  const wob=Math.sin(now*0.007+e.id*1.9)*1.5;
  const isS=e.stunned>0;
  const col=isS?'#5599ff':'#cc1111';
  const dk=isS?'#3366cc':'#880000';

  ctx.save();
  ctx.translate(sx,sy-bounce);
  if(e.vx<-5) ctx.scale(-1,1);

  ctx.shadowColor=isS?'#88aaff':'#dd2222'; ctx.shadowBlur=7;

  // Stumpy legs
  ctx.fillStyle=dk;
  ctx.fillRect(-9,-10+bounce*0.3,7,12);
  ctx.fillRect(2,-10-bounce*0.3,7,12);

  // Arms
  ctx.fillStyle=col;
  ctx.fillRect(-20,-28-bounce*0.2,8,12);
  ctx.fillRect(12,-28+bounce*0.2,8,12);

  // Blob body
  ctx.fillStyle=col;
  ctx.beginPath(); ctx.ellipse(wob,-22,15,17,0,0,Math.PI*2); ctx.fill();
  // Dark underside
  ctx.fillStyle=dk;
  ctx.beginPath(); ctx.ellipse(wob,-14,14,8,0,0,Math.PI); ctx.fill();

  // Big dark eyes
  ctx.shadowBlur=0;
  ctx.fillStyle='#0d0d0d';
  ctx.beginPath(); ctx.arc(-5+wob,-26,5.5,0,Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.arc(6+wob,-26,5.5,0,Math.PI*2); ctx.fill();
  // Red irises
  ctx.fillStyle=isS?'#88ccff':'#bb2222';
  ctx.beginPath(); ctx.arc(-4+wob,-27,2.5,0,Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.arc(7+wob,-27,2.5,0,Math.PI*2); ctx.fill();
  // Pupils
  ctx.fillStyle='#000';
  ctx.beginPath(); ctx.arc(-3+wob,-27,1,0,Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.arc(8+wob,-27,1,0,Math.PI*2); ctx.fill();

  // Jagged grin
  ctx.fillStyle='#0d0d0d';
  ctx.fillRect(-8+wob,-18,16,6);
  ctx.fillStyle='#ddcc77';
  for(let i=0;i<4;i++) { ctx.fillRect(-7+wob+i*4,-18,3,4); }
  ctx.fillStyle='#ccbb66';
  for(let i=0;i<3;i++) { ctx.fillRect(-5+wob+i*4,-13,3,-3); }

  ctx.shadowBlur=0; ctx.restore();
}

// Stray (hooded archer with glowing eyes and shotgun arm)
function drawStray(ctx:CanvasRenderingContext2D, e:Enemy, camX:number, camY:number, now:number) {
  const sx=e.x+e.w/2-camX, sy=e.y+e.h-camY;
  const moving=Math.abs(e.vx)>10;
  const ws=Math.sin(now*0.009+e.id*2.1);
  const isS=e.stunned>0;
  const rc=isS?'#4466bb':'#1144cc';
  const dk=isS?'#2244aa':'#0a2288';
  const hc=isS?'#334499':'#060e55';

  ctx.save();
  ctx.translate(sx,sy);
  if(e.vx<-5) ctx.scale(-1,1);

  ctx.shadowColor=isS?'#88aaff':'#2266ff'; ctx.shadowBlur=7;

  // Shuffling feet
  ctx.fillStyle=dk;
  ctx.fillRect(-7,-8+(moving?ws*3:0),6,10);
  ctx.fillRect(1,-8-(moving?ws*3:0),6,10);

  // Robe body (trapezoidal)
  ctx.fillStyle=rc;
  ctx.beginPath();
  ctx.moveTo(-14,-40); ctx.lineTo(14,-40);
  ctx.lineTo(18,-8); ctx.lineTo(-18,-8);
  ctx.closePath(); ctx.fill();
  // Robe center fold
  ctx.fillStyle=dk;
  ctx.fillRect(-2,-38,4,30);
  ctx.fillStyle=rc;
  ctx.fillRect(-1,-38,2,30);

  // Left arm tucked
  ctx.fillStyle=dk;
  ctx.fillRect(-18,-38,7,14);

  // Right arm + SHOTGUN
  ctx.fillStyle=rc;
  ctx.fillRect(12,-38,8,14);
  ctx.fillStyle=dk;
  ctx.fillRect(19,-32,7,10);
  ctx.fillStyle='#444';
  ctx.fillRect(24,-31,24,6);   // barrel
  ctx.fillStyle='#666';
  ctx.fillRect(24,-29,24,3);   // shine
  ctx.fillStyle='#333';
  ctx.fillRect(46,-33,5,10);   // muzzle
  ctx.fillStyle='#555';
  ctx.fillRect(28,-25,8,4);    // guard

  // Pointed hood
  ctx.fillStyle=hc;
  ctx.beginPath();
  ctx.moveTo(-13,-40); ctx.lineTo(0,-67); ctx.lineTo(13,-40);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle='#0a0a0a';
  ctx.fillRect(-11,-52,22,14); // shadow interior
  ctx.fillStyle=rc;
  ctx.fillRect(-13,-40,26,3);  // rim

  // Glowing eyes under hood
  ctx.fillStyle=isS?'#88ccff':'#22ddff';
  ctx.shadowColor=isS?'#88ccff':'#22ddff'; ctx.shadowBlur=12;
  ctx.beginPath(); ctx.arc(-4,-48,3.5,0,Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.arc(5,-48,3.5,0,Math.PI*2); ctx.fill();
  ctx.fillStyle=isS?'#cceeff':'#88eeff';
  ctx.beginPath(); ctx.arc(-4,-48,1.5,0,Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.arc(5,-48,1.5,0,Math.PI*2); ctx.fill();

  ctx.shadowBlur=0; ctx.restore();
}

// Schism (split warrior with glowing seam and huge arm)
function drawSchism(ctx:CanvasRenderingContext2D, e:Enemy, camX:number, camY:number, now:number) {
  const sx=e.x+e.w/2-camX, sy=e.y+e.h-camY;
  const ws=Math.sin(now*0.008+e.id*3.3);
  const isS=e.stunned>0;
  const bc=isS?'#4488cc':'#cc5500';
  const dk=isS?'#2255aa':'#882200';
  const sc=isS?'#88ccff':'#ffaa44';
  const uo=Math.sin(now*0.005+e.id)*2; // upper half offset

  ctx.save();
  ctx.translate(sx,sy);
  if(e.vx<-5) ctx.scale(-1,1);

  ctx.shadowColor=isS?'#88aaff':'#cc5500'; ctx.shadowBlur=9;

  // Legs (bony)
  ctx.fillStyle=dk;
  ctx.fillRect(-10,-18+ws*5,8,20);
  ctx.fillRect(2,-18-ws*5,8,20);
  ctx.fillStyle=sc;
  ctx.shadowColor=sc; ctx.shadowBlur=4;
  ctx.fillRect(-10,-9+ws*2,8,2);  // knee joint glow
  ctx.fillRect(2,-9-ws*2,8,2);
  ctx.shadowBlur=9;

  // Lower torso half
  ctx.fillStyle=bc;
  ctx.fillRect(-13,-36,26,18);
  ctx.fillStyle=dk;
  ctx.fillRect(-11,-34,22,14);

  // Upper torso half (slightly floating/offset)
  ctx.fillStyle=bc;
  ctx.fillRect(-13,-55+uo,26,21);
  ctx.fillStyle=dk;
  ctx.fillRect(-11,-53+uo,22,17);

  // Glowing seam (Schism signature)
  ctx.fillStyle=sc;
  ctx.shadowColor=sc; ctx.shadowBlur=12;
  ctx.fillRect(-2,-55+uo,4,37);
  ctx.shadowBlur=9;

  // Small left arm
  ctx.fillStyle=dk;
  ctx.shadowBlur=0;
  ctx.fillRect(-20,-52+ws*2+uo,8,22);
  ctx.fillStyle=bc;
  ctx.fillRect(-20,-52+ws*2+uo,8,4);

  // HUGE right arm (Schism signature)
  ctx.fillStyle=bc;
  ctx.fillRect(12,-54+uo,12,28);
  ctx.fillStyle=sc;
  ctx.shadowColor=sc; ctx.shadowBlur=6;
  ctx.fillRect(23,-56+uo,22,30); // massive fist
  ctx.fillStyle=bc;
  ctx.fillRect(23,-56+uo,22,5);  // top

  // Skull head
  ctx.shadowBlur=0;
  ctx.fillStyle=bc;
  ctx.fillRect(-11,-69+uo,22,16);
  ctx.fillStyle=dk;
  ctx.fillRect(-8,-69+uo,16,4);
  ctx.fillStyle='#0a0a0a';
  ctx.fillRect(-8,-64+uo,6,7);
  ctx.fillRect(2,-64+uo,6,7);
  ctx.fillStyle=sc;
  ctx.shadowColor=sc; ctx.shadowBlur=8;
  ctx.fillRect(-7,-63+uo,4,5);
  ctx.fillRect(3,-63+uo,4,5);

  ctx.shadowBlur=0; ctx.restore();
}

// Grenadier – yellow robed figure, lobs grenades (RANGED/YELLOW)
function drawGrenadier(ctx:CanvasRenderingContext2D, e:Enemy, camX:number, camY:number, now:number) {
  const sx=e.x+e.w/2-camX, sy=e.y+e.h-camY;
  const isS=e.stunned>0;
  const moving=Math.abs(e.vx)>10;
  const ws=Math.sin(now*0.009+e.id*2.7);
  const windUp=e.hesTimer>0;
  const rc=isS?'#4466bb':'#cc9900';
  const dk=isS?'#2244aa':'#886600';
  const hc=isS?'#334499':'#553300';

  ctx.save();
  ctx.translate(sx,sy);
  if(e.vx<-5) ctx.scale(-1,1);

  ctx.shadowColor=isS?'#88aaff':'#ffcc00'; ctx.shadowBlur=8;

  // Feet
  ctx.fillStyle=dk;
  ctx.fillRect(-7,-8+(moving?ws*3:0),6,10);
  ctx.fillRect(1,-8-(moving?ws*3:0),6,10);

  // Robe (wider at bottom)
  ctx.fillStyle=rc;
  ctx.beginPath();
  ctx.moveTo(-14,-40); ctx.lineTo(14,-40);
  ctx.lineTo(19,-8); ctx.lineTo(-19,-8);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle=dk;
  ctx.fillRect(-2,-38,4,30);
  ctx.fillStyle=rc;
  ctx.fillRect(-1,-38,2,30);

  // Left arm tucked
  ctx.fillStyle=dk;
  ctx.fillRect(-19,-38,7,14);

  // Right arm raised (wind-up = raised higher)
  const armRaise=windUp?-12:0;
  ctx.fillStyle=rc;
  ctx.fillRect(12,-38+armRaise,8,14);
  ctx.fillStyle=dk;
  ctx.fillRect(18,-32+armRaise,8,14);

  // Grenade in hand (round + pin)
  const gc=windUp?'#ffff44':'#aaff22';
  ctx.fillStyle=gc;
  ctx.shadowColor=gc; ctx.shadowBlur=windUp?14:6;
  ctx.beginPath(); ctx.arc(30,-32+armRaise,7,0,Math.PI*2); ctx.fill();
  ctx.fillStyle='#888';
  ctx.fillRect(28,-42+armRaise,4,10); // pin / stem
  ctx.fillStyle='#ccc';
  ctx.fillRect(26,-39+armRaise,8,3);  // safety lever

  // Pointed hood (wider brim)
  ctx.shadowBlur=8; ctx.fillStyle=hc;
  ctx.beginPath();
  ctx.moveTo(-15,-40); ctx.lineTo(0,-65); ctx.lineTo(15,-40);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle='#0a0a0a';
  ctx.fillRect(-12,-52,24,13);
  ctx.fillStyle=rc;
  ctx.fillRect(-15,-40,30,3);

  // Eyes (amber/gold)
  ctx.fillStyle=isS?'#88ccff':'#ffcc00';
  ctx.shadowColor=ctx.fillStyle; ctx.shadowBlur=10;
  ctx.beginPath(); ctx.arc(-4,-48,3,0,Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.arc(5,-48,3,0,Math.PI*2); ctx.fill();

  ctx.shadowBlur=0; ctx.restore();
}

// Seraphim – angelic six-winged being of gold and white, shoots holy lasers
function drawFlyer(ctx:CanvasRenderingContext2D, e:Enemy, camX:number, camY:number, now:number) {
  const sx=e.x+e.w/2-camX, sy=e.y+e.h/2-camY;
  const isS=e.stunned>0;
  const t=now*0.0062+e.id*1.7;
  const hover=Math.sin(t)*5; // gentle float
  const flap=Math.sin(t*2.1);  // wing beat
  const charging=e.hesTimer>0;

  const gold=isS?'#88aadd':'#f5c842';
  const goldLt=isS?'#aaccee':'#fff0a0';
  const goldDk=isS?'#4466aa':'#c8960a';
  const white=isS?'#aaccee':'#fffce8';
  const glow=isS?'#88aaff':'#ffe040';

  ctx.save();
  ctx.translate(sx, sy+hover);
  if(e.vx<-5) ctx.scale(-1,1);

  // ── Halo (ring above head) ──
  ctx.save();
  ctx.translate(0,-44);
  const haloPulse=charging?1+Math.sin(now*0.025)*0.4:1;
  ctx.strokeStyle=glow;
  ctx.shadowColor=glow; ctx.shadowBlur=charging?20:12;
  ctx.lineWidth=3*haloPulse;
  ctx.beginPath(); ctx.ellipse(0,0,14,4.5,0,0,Math.PI*2); ctx.stroke();
  // Halo shimmer
  ctx.fillStyle=goldLt; ctx.globalAlpha=0.5*haloPulse;
  ctx.beginPath(); ctx.ellipse(0,0,14,4.5,0,0,Math.PI*2); ctx.fill();
  ctx.globalAlpha=1; ctx.shadowBlur=0;
  ctx.restore();

  // ── Upper wings (largest pair — spread wide) ──
  ctx.shadowColor=glow; ctx.shadowBlur=10;
  const upperFlap=flap*16;
  ctx.fillStyle=isS?'rgba(100,150,220,0.7)':'rgba(255,245,180,0.75)';
  // Left upper wing
  ctx.beginPath();
  ctx.moveTo(-5,-22);
  ctx.quadraticCurveTo(-50,-38+upperFlap,-46,-14+upperFlap*0.5);
  ctx.quadraticCurveTo(-24,-4,-5,-14);
  ctx.closePath(); ctx.fill();
  // Right upper wing
  ctx.beginPath();
  ctx.moveTo(5,-22);
  ctx.quadraticCurveTo(50,-38+upperFlap,46,-14+upperFlap*0.5);
  ctx.quadraticCurveTo(24,-4,5,-14);
  ctx.closePath(); ctx.fill();

  // Wing feather lines
  ctx.strokeStyle=goldDk; ctx.lineWidth=1; ctx.globalAlpha=0.5;
  for(let f=0;f<4;f++){
    const fx=f*10+8;
    ctx.beginPath(); ctx.moveTo(-5,-18); ctx.lineTo(-fx,-28+upperFlap*(0.3+f*0.1)); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(5,-18); ctx.lineTo(fx,-28+upperFlap*(0.3+f*0.1)); ctx.stroke();
  }
  ctx.globalAlpha=1;

  // ── Middle wings (medium) ──
  const midFlap=Math.sin(t*2.1+0.8)*10;
  ctx.fillStyle=isS?'rgba(120,160,230,0.65)':'rgba(255,250,200,0.65)';
  ctx.beginPath();
  ctx.moveTo(-4,-8);
  ctx.quadraticCurveTo(-38,-12+midFlap,-34,4+midFlap*0.4);
  ctx.quadraticCurveTo(-18,10,-4,4);
  ctx.closePath(); ctx.fill();
  ctx.beginPath();
  ctx.moveTo(4,-8);
  ctx.quadraticCurveTo(38,-12+midFlap,34,4+midFlap*0.4);
  ctx.quadraticCurveTo(18,10,4,4);
  ctx.closePath(); ctx.fill();

  // ── Lower wings (smallest, swept down) ──
  const lwFlap=Math.sin(t*2.1+1.6)*7;
  ctx.fillStyle=isS?'rgba(100,140,210,0.55)':'rgba(255,240,160,0.55)';
  ctx.beginPath();
  ctx.moveTo(-4,4);
  ctx.quadraticCurveTo(-26,14+lwFlap,-22,24+lwFlap*0.5);
  ctx.quadraticCurveTo(-10,26,-4,14);
  ctx.closePath(); ctx.fill();
  ctx.beginPath();
  ctx.moveTo(4,4);
  ctx.quadraticCurveTo(26,14+lwFlap,22,24+lwFlap*0.5);
  ctx.quadraticCurveTo(10,26,4,14);
  ctx.closePath(); ctx.fill();

  // ── Robed body ──
  ctx.shadowColor=glow; ctx.shadowBlur=8;
  ctx.fillStyle=white;
  ctx.beginPath();
  ctx.moveTo(-9,-24); ctx.lineTo(9,-24);
  ctx.lineTo(12,14); ctx.lineTo(-12,14);
  ctx.closePath(); ctx.fill();
  // Robe fold lines
  ctx.fillStyle=goldDk; ctx.globalAlpha=0.35;
  ctx.fillRect(-1,-22,2,34);
  ctx.fillRect(-5,-10,1,20);
  ctx.fillRect(4,-10,1,20);
  ctx.globalAlpha=1;
  // Chest band
  ctx.fillStyle=gold;
  ctx.fillRect(-9,-14,18,4);
  ctx.fillRect(-9,-4,18,3);

  // ── Head ──
  ctx.fillStyle=white;
  ctx.beginPath(); ctx.ellipse(0,-32,8,9,0,0,Math.PI*2); ctx.fill();
  // Face veil
  ctx.fillStyle=goldDk; ctx.globalAlpha=0.25;
  ctx.fillRect(-8,-38,16,14);
  ctx.globalAlpha=1;

  // ── Glowing eyes (holy gold) ──
  ctx.fillStyle=charging?'#ffffff':gold;
  ctx.shadowColor=charging?'#ffffff':glow; ctx.shadowBlur=charging?20:14;
  ctx.beginPath(); ctx.arc(-3,-31,3,0,Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.arc(3,-31,3,0,Math.PI*2); ctx.fill();
  ctx.fillStyle='#fff';
  ctx.beginPath(); ctx.arc(-3,-31,1.2,0,Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.arc(3,-31,1.2,0,Math.PI*2); ctx.fill();

  // Laser charge glow
  if(charging){
    ctx.shadowColor='#fffbe0'; ctx.shadowBlur=28;
    ctx.fillStyle='rgba(255,250,180,0.18)';
    ctx.beginPath(); ctx.arc(0,-10,26,0,Math.PI*2); ctx.fill();
  }

  ctx.shadowBlur=0; ctx.restore();
}

// Mirror Knight boss (black inverse V1 with red glow)
function drawMirrorV1(ctx:CanvasRenderingContext2D, boss:Boss, camX:number, camY:number, now:number) {
  if(boss.dead) return;
  const sx=boss.x+boss.w/2-camX, sy=boss.y+boss.h-camY;
  const moving=Math.abs(boss.vx)>20;
  const leg=moving?Math.sin(now*0.011*(boss.facingRight?1:-1)*6)*11:0;
  const arm=moving?Math.sin(now*0.011*(boss.facingRight?1:-1)*6+Math.PI)*7:0;
  const gcs=['#ff2200','#ff4400','#ff7700'];
  const gc=gcs[boss.phase-1];
  const pulse=boss.phase===3?16+Math.sin(now*0.007)*7:boss.phase===2?12:9;
  const S=1.3;

  ctx.save();
  ctx.translate(sx,sy);
  if(!boss.facingRight) ctx.scale(-1,1);
  ctx.scale(S,S);

  ctx.shadowColor=gc; ctx.shadowBlur=pulse;

  // Legs (black with red joints)
  ctx.fillStyle='#070707';
  ctx.fillRect(-11,-14-leg,8,15+leg);
  ctx.fillRect(3,-14+leg,8,15-leg);
  ctx.fillStyle=gc; ctx.shadowBlur=5;
  ctx.fillRect(-11,-4-leg*0.4,10,2);   // knee highlight
  ctx.fillRect(3,-4+leg*0.4,10,2);
  ctx.shadowBlur=pulse;
  ctx.fillStyle='#0d0d0d';
  ctx.fillRect(-12,-2-leg,11,5);   // boot
  ctx.fillRect(2,-2+leg,11,5);

  // Left arm
  ctx.fillStyle='#070707';
  ctx.fillRect(-17,-43+arm,7,17);
  ctx.fillStyle=gc; ctx.shadowBlur=4;
  ctx.fillRect(-17,-33+arm,7,2); // elbow
  ctx.shadowBlur=pulse;

  // Right arm + glowing gun
  ctx.fillStyle='#070707';
  ctx.fillRect(10,-43-arm,7,17);
  ctx.fillStyle=gc; ctx.shadowBlur=10;
  ctx.fillRect(15,-31-arm,20,6);  // glowing barrel
  ctx.fillStyle='#330000';
  ctx.fillRect(15,-34-arm,8,4);
  ctx.fillStyle=gc; ctx.shadowBlur=8;
  ctx.fillRect(33,-33-arm,4,9); // muzzle

  // Torso (black)
  ctx.shadowBlur=pulse;
  ctx.fillStyle='#050505';
  ctx.fillRect(-12,-45,24,32);
  ctx.fillStyle=gc; ctx.shadowBlur=4;
  ctx.fillRect(-10,-39,20,2);   // chest lines (red)
  ctx.fillRect(-10,-30,20,2);
  ctx.fillRect(-10,-21,20,2);
  ctx.shadowBlur=pulse;

  // Shoulder pads
  ctx.fillStyle='#0a0a0a';
  ctx.fillRect(-18,-46,8,10);
  ctx.fillRect(10,-46,8,10);
  ctx.fillStyle=gc; ctx.shadowBlur=4;
  ctx.fillRect(-18,-46,8,2);
  ctx.fillRect(10,-46,8,2);
  ctx.shadowBlur=pulse;

  // Head (black angular)
  ctx.fillStyle='#050505';
  ctx.fillRect(-10,-65,20,21);
  ctx.fillStyle='#0a0a0a';
  ctx.fillRect(-14,-63,5,14);
  ctx.fillRect(9,-63,5,14);
  ctx.fillStyle=gc; ctx.shadowBlur=4;
  ctx.fillRect(-10,-65,20,2);   // head outline (red)
  ctx.fillRect(-10,-65,2,21);
  ctx.fillRect(8,-65,2,21);
  ctx.shadowBlur=pulse;

  // RED VISOR (inverted from white V1)
  ctx.fillStyle=gc;
  ctx.shadowColor=gc; ctx.shadowBlur=18;
  ctx.fillRect(-7,-57,18,7);
  ctx.fillStyle='#ffbbaa';
  ctx.shadowBlur=8;
  ctx.fillRect(-4,-56,9,5);   // bright center

  // Parry shield
  if(boss.parryActive) {
    ctx.shadowBlur=0;
    ctx.fillStyle='rgba(255,40,0,0.2)';
    ctx.fillRect(-26,-74,52,80);
    ctx.strokeStyle=gc; ctx.lineWidth=2;
    ctx.strokeRect(-26,-74,52,80);
  }

  ctx.shadowBlur=0; ctx.restore();

  // Phase dots
  for(let i=0;i<boss.phase;i++) {
    ctx.fillStyle=gcs[i]; ctx.shadowColor=gcs[i]; ctx.shadowBlur=7;
    ctx.fillRect(sx-15+i*15,sy-boss.h*S-20,11,5);
  }
  ctx.shadowBlur=0;

  // Grapple rope
  if(boss.grappleOn||boss.grapple) {
    const gx=boss.grappleX-camX, gy=boss.grappleY-camY;
    ctx.strokeStyle=`${gc}cc`; ctx.lineWidth=3;
    ctx.setLineDash([5,3]); ctx.lineDashOffset=-(now*0.07%8);
    ctx.beginPath(); ctx.moveTo(sx,sy-boss.h*S*0.5); ctx.lineTo(gx,gy); ctx.stroke();
    ctx.setLineDash([]); ctx.lineDashOffset=0;
    ctx.fillStyle=gc; ctx.shadowColor=gc; ctx.shadowBlur=10;
    ctx.beginPath(); ctx.arc(gx,gy,6,0,Math.PI*2); ctx.fill();
    ctx.shadowBlur=0;
  }
}

// ─── RENDERER ────────────────────────────────────────────────────────────────
function render(ctx:CanvasRenderingContext2D, gs:GS) {
  const now=Date.now();
  const camX=gs.camX, camY=gs.camY;
  const W=ctx.canvas.width, H=ctx.canvas.height;
  const postBoss=gs.postBoss;

  function wx(x:number){ return x-camX; }
  function wy(y:number){ return y-camY; }

  if(!postBoss) {
    // ── HELL Background ──
    const bgGrad=ctx.createLinearGradient(0,0,0,H);
    bgGrad.addColorStop(0,'#050000'); bgGrad.addColorStop(0.4,'#130000');
    bgGrad.addColorStop(0.75,'#200500'); bgGrad.addColorStop(1,'#2e0800');
    ctx.fillStyle=bgGrad; ctx.fillRect(0,0,W,H);

    // Far: jagged mountain silhouettes
    ctx.save();
    const mtnOff=(camX*0.06)%(W+160);
    ctx.globalAlpha=0.22; ctx.fillStyle='#0d0000';
    ctx.beginPath(); ctx.moveTo(-mtnOff,H);
    for(let mx=0;mx<W*2+240;mx+=80){
      const ph=90+Math.sin(mx*0.031+7)*45+Math.sin(mx*0.078)*22;
      ctx.lineTo(mx-mtnOff,H-ph);
      ctx.lineTo(mx+40-mtnOff,H-ph-28-Math.abs(Math.sin(mx*0.05))*18);
      ctx.lineTo(mx+80-mtnOff,H-ph+8);
    }
    ctx.lineTo(W*2,H); ctx.closePath(); ctx.fill();
    ctx.restore();

    // Mid: rock spires with orange base glow
    ctx.save();
    const spireOff=(camX*0.18)%220;
    for(let s=-1;s<Math.ceil(W/220)+2;s++){
      const sx=s*220-spireOff, sh=65+(s%4)*20;
      ctx.globalAlpha=0.38; ctx.fillStyle='#120100';
      ctx.beginPath();
      ctx.moveTo(sx+10,H); ctx.lineTo(sx+26,H-sh); ctx.lineTo(sx+38,H-sh+8);
      ctx.lineTo(sx+50,H-sh-12); ctx.lineTo(sx+62,H-sh+5); ctx.lineTo(sx+75,H);
      ctx.closePath(); ctx.fill();
      const sg=ctx.createLinearGradient(0,H-sh,0,H);
      sg.addColorStop(0,'rgba(255,60,0,0)'); sg.addColorStop(1,'rgba(255,80,0,0.2)');
      ctx.fillStyle=sg; ctx.globalAlpha=0.5; ctx.fillRect(sx,H-sh,75,sh);
    }
    ctx.restore();

    // Lava fog at bottom
    const fogGrad=ctx.createLinearGradient(0,H-120,0,H);
    fogGrad.addColorStop(0,'rgba(180,30,0,0)'); fogGrad.addColorStop(0.5,'rgba(220,60,0,0.18)');
    fogGrad.addColorStop(1,'rgba(255,100,10,0.35)');
    ctx.fillStyle=fogGrad; ctx.fillRect(0,H-120,W,120);

    // Lava floor
    const gndY=wy(GROUND_Y);
    const lavaGrad=ctx.createLinearGradient(0,gndY,0,H);
    lavaGrad.addColorStop(0,'#3d0800'); lavaGrad.addColorStop(0.2,'#280400'); lavaGrad.addColorStop(1,'#100100');
    ctx.fillStyle=lavaGrad; ctx.fillRect(0,gndY,W,H-gndY);
    const crackT=now*0.0004;
    ctx.strokeStyle='rgba(255,80,0,0.42)'; ctx.lineWidth=1.5;
    const crackOff=(camX*1.0)%96;
    for(let row2=0;row2*28<H-gndY;row2++){
      const ry2=gndY+row2*28+Math.sin(crackT+row2)*1.5;
      const xsh2=row2%2===0?0:48;
      for(let col2=-1;col2<Math.ceil(W/96)+2;col2++){
        const cx4=col2*96+xsh2-crackOff;
        ctx.beginPath();
        ctx.moveTo(cx4,ry2); ctx.lineTo(cx4+22,ry2+6+Math.sin(crackT*2.1+col2)*3);
        ctx.lineTo(cx4+48,ry2+2); ctx.lineTo(cx4+72,ry2+8+Math.sin(crackT*1.7+row2)*2);
        ctx.lineTo(cx4+96,ry2+1); ctx.stroke();
      }
    }
    const lavaSurf=ctx.createLinearGradient(0,gndY-8,0,gndY+20);
    lavaSurf.addColorStop(0,'rgba(255,100,0,0)'); lavaSurf.addColorStop(0.4,'rgba(255,80,0,0.55)');
    lavaSurf.addColorStop(1,'rgba(180,30,0,0)');
    ctx.fillStyle=lavaSurf; ctx.fillRect(0,gndY-8,W,28);
  } else {
    // ── VOID Background (post-boss) ──
    const bgGrad=ctx.createLinearGradient(0,0,0,H);
    bgGrad.addColorStop(0,'#00000f'); bgGrad.addColorStop(0.45,'#02001a');
    bgGrad.addColorStop(0.8,'#04001f'); bgGrad.addColorStop(1,'#060028');
    ctx.fillStyle=bgGrad; ctx.fillRect(0,0,W,H);

    // Stars
    ctx.save();
    const starSeed=42;
    for(let i=0;i<160;i++){
      const sx2=((Math.sin(i*starSeed)*43758.5453)%1+1)%1*W*2-(camX*0.02)%W;
      const sy2=((Math.cos(i*starSeed*2.1)*43758.5453)%1+1)%1*(H*0.85);
      const ss=(((Math.sin(i*7.3)*43758.5453)%1+1)%1)*1.8+0.4;
      const sp=(Math.sin(now*0.001+i)*0.3+0.7);
      ctx.globalAlpha=sp*0.75; ctx.fillStyle='#ffffff';
      ctx.fillRect(sx2%W,sy2,ss,ss);
    }
    ctx.restore();

    // Distant void mountain silhouettes
    ctx.save();
    const mtnOff=(camX*0.06)%(W+160);
    ctx.globalAlpha=0.3; ctx.fillStyle='#06003a';
    ctx.beginPath(); ctx.moveTo(-mtnOff,H);
    for(let mx=0;mx<W*2+240;mx+=80){
      const ph=90+Math.sin(mx*0.031+7)*45+Math.sin(mx*0.078)*22;
      ctx.lineTo(mx-mtnOff,H-ph);
      ctx.lineTo(mx+40-mtnOff,H-ph-28-Math.abs(Math.sin(mx*0.05))*18);
      ctx.lineTo(mx+80-mtnOff,H-ph+8);
    }
    ctx.lineTo(W*2,H); ctx.closePath(); ctx.fill();
    ctx.restore();

    // Mid: void crystal spires with purple glow
    ctx.save();
    const spireOff=(camX*0.18)%220;
    for(let s=-1;s<Math.ceil(W/220)+2;s++){
      const sx=s*220-spireOff, sh=65+(s%4)*20;
      ctx.globalAlpha=0.45; ctx.fillStyle='#08003a';
      ctx.beginPath();
      ctx.moveTo(sx+10,H); ctx.lineTo(sx+26,H-sh); ctx.lineTo(sx+38,H-sh+8);
      ctx.lineTo(sx+50,H-sh-12); ctx.lineTo(sx+62,H-sh+5); ctx.lineTo(sx+75,H);
      ctx.closePath(); ctx.fill();
      const sg=ctx.createLinearGradient(0,H-sh,0,H);
      sg.addColorStop(0,'rgba(140,0,255,0)'); sg.addColorStop(1,'rgba(100,0,220,0.22)');
      ctx.fillStyle=sg; ctx.globalAlpha=0.55; ctx.fillRect(sx,H-sh,75,sh);
    }
    ctx.restore();

    // Void mist at bottom
    const fogGrad=ctx.createLinearGradient(0,H-120,0,H);
    fogGrad.addColorStop(0,'rgba(60,0,140,0)'); fogGrad.addColorStop(0.5,'rgba(80,0,180,0.18)');
    fogGrad.addColorStop(1,'rgba(120,0,255,0.32)');
    ctx.fillStyle=fogGrad; ctx.fillRect(0,H-120,W,120);

    // Void floor
    const gndY=wy(GROUND_Y);
    const voidFloor=ctx.createLinearGradient(0,gndY,0,H);
    voidFloor.addColorStop(0,'#0a0030'); voidFloor.addColorStop(0.2,'#060020'); voidFloor.addColorStop(1,'#020010');
    ctx.fillStyle=voidFloor; ctx.fillRect(0,gndY,W,H-gndY);
    // Animated electric cracks
    const crackT=now*0.0005;
    ctx.strokeStyle='rgba(100,0,255,0.45)'; ctx.lineWidth=1.5;
    const crackOff=(camX*1.0)%96;
    for(let row2=0;row2*28<H-gndY;row2++){
      const ry2=gndY+row2*28+Math.sin(crackT+row2)*1.5;
      const xsh2=row2%2===0?0:48;
      for(let col2=-1;col2<Math.ceil(W/96)+2;col2++){
        const cx4=col2*96+xsh2-crackOff;
        ctx.beginPath();
        ctx.moveTo(cx4,ry2); ctx.lineTo(cx4+22,ry2+6+Math.sin(crackT*2.1+col2)*3);
        ctx.lineTo(cx4+48,ry2+2); ctx.lineTo(cx4+72,ry2+8+Math.sin(crackT*1.7+row2)*2);
        ctx.lineTo(cx4+96,ry2+1); ctx.stroke();
      }
    }
    // Void energy surface line
    const voidSurf=ctx.createLinearGradient(0,gndY-8,0,gndY+20);
    voidSurf.addColorStop(0,'rgba(160,0,255,0)'); voidSurf.addColorStop(0.4,'rgba(120,0,255,0.6)');
    voidSurf.addColorStop(1,'rgba(60,0,180,0)');
    ctx.fillStyle=voidSurf; ctx.fillRect(0,gndY-8,W,28);
  }

  // ── Platforms ──
  for(const plat of gs.platforms) {
    const px=wx(plat.x), py=wy(plat.y);
    const seed=plat.id*13.7;
    const pulse=0.6+Math.sin(now*0.002+seed)*0.4;
    if(!postBoss) {
      // Magma Rock
      const drip=ctx.createLinearGradient(0,py+plat.h,0,py+plat.h+22);
      drip.addColorStop(0,`rgba(255,80,0,${0.5*pulse})`);
      drip.addColorStop(0.4,`rgba(200,40,0,${0.28*pulse})`);
      drip.addColorStop(1,'rgba(100,10,0,0)');
      ctx.fillStyle=drip; ctx.fillRect(px-2,py+plat.h-2,plat.w+4,24);
      const pbody=ctx.createLinearGradient(0,py,0,py+plat.h);
      pbody.addColorStop(0,'#1a0800'); pbody.addColorStop(0.5,'#0d0400'); pbody.addColorStop(1,'#080200');
      ctx.fillStyle=pbody; ctx.fillRect(px,py+3,plat.w,plat.h-3);
      ctx.shadowColor='#ff5500'; ctx.shadowBlur=6*pulse;
      ctx.strokeStyle=`rgba(255,${80+Math.round(pulse*60)},0,${0.7*pulse})`; ctx.lineWidth=1.5;
      const cStep=Math.max(20,Math.floor(plat.w/5));
      for(let ci=0;ci<plat.w;ci+=cStep){
        ctx.beginPath(); ctx.moveTo(px+ci,py+4);
        ctx.lineTo(px+ci+cStep*0.3,py+plat.h*0.5+Math.sin(seed+ci)*3);
        ctx.lineTo(px+ci+cStep*0.65,py+plat.h*0.3+Math.cos(seed+ci*0.7)*2);
        ctx.lineTo(px+ci+cStep,py+plat.h-3); ctx.stroke();
      }
      ctx.shadowBlur=0;
      const topG=ctx.createLinearGradient(0,py,0,py+6);
      topG.addColorStop(0,`rgba(255,${120+Math.round(pulse*80)},0,${0.85*pulse})`);
      topG.addColorStop(1,'rgba(180,40,0,0)');
      ctx.fillStyle=topG; ctx.fillRect(px,py,plat.w,6);
      ctx.shadowColor='#ff8800'; ctx.shadowBlur=8*pulse;
      ctx.fillStyle=`rgba(255,${150+Math.round(pulse*60)},${20+Math.round(pulse*30)},0.9)`;
      ctx.fillRect(px,py,plat.w,2); ctx.shadowBlur=0;
    } else {
      // Void Crystal
      const drip=ctx.createLinearGradient(0,py+plat.h,0,py+plat.h+22);
      drip.addColorStop(0,`rgba(120,0,255,${0.5*pulse})`);
      drip.addColorStop(0.4,`rgba(80,0,180,${0.28*pulse})`);
      drip.addColorStop(1,'rgba(20,0,80,0)');
      ctx.fillStyle=drip; ctx.fillRect(px-2,py+plat.h-2,plat.w+4,24);
      const pbody=ctx.createLinearGradient(0,py,0,py+plat.h);
      pbody.addColorStop(0,'#0c0030'); pbody.addColorStop(0.5,'#08001e'); pbody.addColorStop(1,'#04000f');
      ctx.fillStyle=pbody; ctx.fillRect(px,py+3,plat.w,plat.h-3);
      ctx.shadowColor='#aa00ff'; ctx.shadowBlur=6*pulse;
      ctx.strokeStyle=`rgba(${80+Math.round(pulse*60)},0,255,${0.7*pulse})`; ctx.lineWidth=1.5;
      const cStep=Math.max(20,Math.floor(plat.w/5));
      for(let ci=0;ci<plat.w;ci+=cStep){
        ctx.beginPath(); ctx.moveTo(px+ci,py+4);
        ctx.lineTo(px+ci+cStep*0.3,py+plat.h*0.5+Math.sin(seed+ci)*3);
        ctx.lineTo(px+ci+cStep*0.65,py+plat.h*0.3+Math.cos(seed+ci*0.7)*2);
        ctx.lineTo(px+ci+cStep,py+plat.h-3); ctx.stroke();
      }
      ctx.shadowBlur=0;
      const topG=ctx.createLinearGradient(0,py,0,py+6);
      topG.addColorStop(0,`rgba(${80+Math.round(pulse*80)},0,255,${0.88*pulse})`);
      topG.addColorStop(1,'rgba(40,0,160,0)');
      ctx.fillStyle=topG; ctx.fillRect(px,py,plat.w,6);
      ctx.shadowColor='#cc44ff'; ctx.shadowBlur=10*pulse;
      ctx.fillStyle=`rgba(${180+Math.round(pulse*60)},${80+Math.round(pulse*60)},255,0.95)`;
      ctx.fillRect(px,py,plat.w,2); ctx.shadowBlur=0;
    }
  }

  // ── Blast rings ──
  for(const bl of gs.blasts) {
    const blx=wx(bl.x), bly=wy(bl.y);
    ctx.globalAlpha=bl.t*0.85;
    ctx.strokeStyle=`rgba(255,${Math.round(160*bl.t+60)},${Math.round(40*bl.t)},1)`;
    ctx.lineWidth=3+bl.t*5; ctx.shadowColor='#ff8800'; ctx.shadowBlur=22;
    ctx.beginPath(); ctx.arc(blx,bly,bl.r,0,Math.PI*2); ctx.stroke();
    if(bl.r>20){
      ctx.globalAlpha=bl.t*0.35;
      ctx.strokeStyle='rgba(255,255,180,0.9)'; ctx.lineWidth=1.5; ctx.shadowColor='#ffffaa';
      ctx.beginPath(); ctx.arc(blx,bly,bl.r*0.55,0,Math.PI*2); ctx.stroke();
    }
    ctx.shadowBlur=0;
  }
  ctx.globalAlpha=1;

  // ── Particles ──
  for(const part of gs.particles) {
    const alpha=part.life/part.maxLife;
    ctx.globalAlpha=alpha;
    ctx.fillStyle=`rgb(${part.r},${part.g},${part.b})`;
    ctx.fillRect(wx(part.x)-part.sz/2, wy(part.y)-part.sz/2, part.sz, part.sz);
  }
  ctx.globalAlpha=1;

  // ── Enemies (ULTRAKILL-styled sprites) ──
  for(const e of gs.enemies) {
    if(e.dead) continue;
    if(e.type==='grunt')           drawFilth(ctx,e,camX,camY,now);
    else if(e.type==='knight')     drawSchism(ctx,e,camX,camY,now);
    else if(e.type==='shotgunner') drawStray(ctx,e,camX,camY,now);
    else if(e.type==='grenadier')  drawGrenadier(ctx,e,camX,camY,now);
    else if(e.type==='flyer')      drawFlyer(ctx,e,camX,camY,now);
    // HP bar above entity
    if(e.hp<e.maxHp) {
      const hx=wx(e.x), hy=wy(e.y)-10;
      ctx.fillStyle='#300'; ctx.fillRect(hx,hy,e.w,5);
      ctx.fillStyle='#f00'; ctx.fillRect(hx,hy,e.w*(e.hp/e.maxHp),5);
    }
  }

  // ── Boss (Mirror V1) ──
  if(gs.boss && !gs.boss.dead) {
    drawMirrorV1(ctx,gs.boss,camX,camY,now);
    // Wide HP bar under boss sprite
    const boss=gs.boss;
    const bw2=boss.w*1.35, boff=(bw2-boss.w)/2;
    const bhx=wx(boss.x)-boff, bhy=wy(boss.y)-14;
    ctx.fillStyle='#400'; ctx.fillRect(bhx,bhy,bw2,7);
    const gc2=boss.phase===3?'#ff7700':boss.phase===2?'#ff4400':'#ff2200';
    ctx.fillStyle=gc2; ctx.shadowColor=gc2; ctx.shadowBlur=5;
    ctx.fillRect(bhx,bhy,bw2*(boss.hp/boss.maxHp),7);
    ctx.shadowBlur=0;
  }

  // ── Player (V1 android) ──
  drawV1(ctx,gs.player,camX,camY,now);

  // ── Bullets ──
  for(const b of gs.bullets) {
    const bsx=wx(b.x+b.w/2), bsy=wy(b.y+b.h/2);
    if(b.btype==='missile') {
      const angle=Math.atan2(b.vy,b.vx);
      ctx.save(); ctx.translate(bsx,bsy); ctx.rotate(angle);
      const trail=ctx.createLinearGradient(-28,0,2,0);
      trail.addColorStop(0,'rgba(255,80,0,0)');
      trail.addColorStop(0.6,'rgba(255,160,0,0.85)');
      trail.addColorStop(1,'rgba(255,230,80,0.7)');
      ctx.fillStyle=trail; ctx.shadowColor='#ff8800'; ctx.shadowBlur=18;
      ctx.fillRect(-26,-5,24,10);
      ctx.fillStyle='#dddddd'; ctx.shadowColor='#ffffff'; ctx.shadowBlur=4;
      ctx.fillRect(-6,-4,18,8);
      ctx.fillStyle='#ff3300'; ctx.shadowColor='#ff4400'; ctx.shadowBlur=10;
      ctx.beginPath(); ctx.moveTo(12,-4); ctx.lineTo(20,0); ctx.lineTo(12,4); ctx.closePath(); ctx.fill();
      ctx.shadowBlur=0; ctx.restore();
    } else if(b.btype==='grenade') {
      ctx.fillStyle='#55ff00'; ctx.shadowColor='#88ff00'; ctx.shadowBlur=10;
      ctx.beginPath(); ctx.arc(bsx,bsy,6,0,Math.PI*2); ctx.fill();
      if(b.fuse>0) {
        ctx.strokeStyle='rgba(255,255,255,0.8)'; ctx.lineWidth=1.5; ctx.shadowBlur=0;
        ctx.beginPath();
        ctx.arc(bsx,bsy,9,-Math.PI/2,-Math.PI/2+Math.PI*2*(1-b.fuse/WEAPONS[2].fuse));
        ctx.stroke();
      }
    } else if(b.btype==='laser') {
      // Holy seraphim laser — elongated golden beam
      const angle=Math.atan2(b.vy,b.vx);
      const len=22, w=3;
      ctx.save();
      ctx.translate(bsx,bsy);
      ctx.rotate(angle);
      const laserGrad=ctx.createLinearGradient(-len,0,len,0);
      laserGrad.addColorStop(0,'rgba(255,240,100,0)');
      laserGrad.addColorStop(0.35,'rgba(255,240,80,0.95)');
      laserGrad.addColorStop(0.65,'rgba(255,255,220,1)');
      laserGrad.addColorStop(1,'rgba(255,240,100,0)');
      ctx.fillStyle=laserGrad;
      ctx.shadowColor='#ffe060'; ctx.shadowBlur=14;
      ctx.fillRect(-len,-w/2,len*2,w);
      // bright core
      ctx.fillStyle='rgba(255,255,255,0.9)';
      ctx.fillRect(-len*0.5,-1,len,2);
      ctx.restore();
    } else if(b.fromPlayer) {
      const col=b.btype==='shotgun'?'#ffaa22':'#ffee22';
      ctx.fillStyle=col; ctx.shadowColor=col; ctx.shadowBlur=7;
      const bsz=b.btype==='shotgun'?5:8;
      ctx.fillRect(bsx-bsz/2,bsy-bsz/2,bsz,bsz);
    } else {
      const col=b.btype==='deflected'?'#44eeff':'#ff3377';
      ctx.fillStyle=col; ctx.shadowColor=col; ctx.shadowBlur=9;
      ctx.beginPath(); ctx.arc(bsx,bsy,5,0,Math.PI*2); ctx.fill();
    }
    ctx.shadowBlur=0;
  }

  // ── Grenade trajectory preview ──
  if(!gs.player.dead && gs.player.weapon===2) {
    const pct=Math.max(0.25, gs.grenadeCharge);
    const throwSpd=220+pct*480;
    const pcx=gs.player.x+gs.player.w/2;
    const pcy=gs.player.y+gs.player.h/2;
    const rdx=gs.aimX-pcx, rdy=gs.aimY-pcy;
    const rlen=Math.hypot(rdx,rdy)||1;
    const nx2=rdx/rlen, ny2=rdy/rlen;
    let tx=pcx, ty=pcy;
    let tvx=nx2*throwSpd, tvy=ny2*throwSpd;
    const stepDt=0.05;
    const maxSteps=Math.ceil(WEAPONS[2].fuse/stepDt)+2;
    const alpha=0.3+pct*0.5;
    ctx.save();
    ctx.setLineDash([5,7]);
    ctx.strokeStyle=`rgba(120,255,60,${alpha})`;
    ctx.lineWidth=1.5;
    ctx.shadowColor='#88ff44'; ctx.shadowBlur=5;
    ctx.beginPath();
    ctx.moveTo(wx(tx),wy(ty));
    let landX=tx, landY=ty;
    for(let i=0;i<maxSteps;i++) {
      tvy+=GRAVITY*0.55*stepDt;
      tx+=tvx*stepDt; ty+=tvy*stepDt;
      let landed=false;
      for(const plat of gs.platforms) {
        if(tx>=plat.x && tx<=plat.x+plat.w && ty+4>=plat.y && ty<=plat.y+plat.h) {
          ty=plat.y-4; landed=true; break;
        }
      }
      if(ty+8>=GROUND_Y){ ty=GROUND_Y-8; landed=true; }
      ctx.lineTo(wx(tx),wy(ty));
      landX=tx; landY=ty;
      if(landed) break;
    }
    ctx.stroke();
    ctx.setLineDash([]); ctx.shadowBlur=0;
    // Landing marker
    ctx.fillStyle=`rgba(120,255,60,${alpha+0.2})`;
    ctx.shadowColor='#88ff44'; ctx.shadowBlur=8;
    ctx.beginPath(); ctx.arc(wx(landX),wy(landY),5,0,Math.PI*2); ctx.fill();
    ctx.shadowBlur=0;
    ctx.restore();
  }

  // ── Grenade charge indicator ──
  if(gs.grenadeCharge>0 && !gs.player.dead) {
    const px=gs.player.x+gs.player.w/2-camX;
    const py=gs.player.y+gs.player.h/2-camY;
    const pct=gs.grenadeCharge;
    ctx.strokeStyle=`rgba(100,255,50,${0.45+pct*0.55})`;
    ctx.lineWidth=3;
    ctx.shadowColor='#66ff22'; ctx.shadowBlur=10;
    ctx.beginPath();
    ctx.arc(px,py,30,-Math.PI/2,-Math.PI/2+Math.PI*2*pct);
    ctx.stroke();
    ctx.fillStyle=`rgba(200,255,100,${pct*0.9})`;
    ctx.font=`bold ${10+Math.round(pct*5)}px monospace`;
    ctx.textAlign='center';
    ctx.fillText(`${Math.round(pct*100)}%`,px,py-40);
    ctx.textAlign='left';
    ctx.shadowBlur=0;
  }

  // ── Subtle ground line ──
  ctx.fillStyle='rgba(80,120,255,0.12)';
  ctx.fillRect(0,wy(GROUND_Y+80)-2,W,2);
}
