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
const GRAPPLE_FORCE = 1300;
const GRAPPLE_RANGE = 480;
const INV_DUR = 0.5;
const BOSS_SPAWN_KILLS = 20;
const BOSS_HP = 1500;

const WEAPONS = [
  { name: 'PISTOL',   cd: 0.22, dmg: 10, spd: 750, pellets: 1, spread: 0,    fuse: 0 },
  { name: 'SHOTGUN',  cd: 0.70, dmg: 16, spd: 580, pellets: 6, spread: 0.28, fuse: 0 },
  { name: 'GRENADE',  cd: 0.85, dmg: 55, spd: 380, pellets: 1, spread: 0,    fuse: 2.8 },
];

const ECFG: Record<string, { w:number;h:number;hp:number;spd:number;pts:number;col:string;det:number;atr:number;adm:number;acd:number }> = {
  grunt:      { w:30,h:42,hp:35,spd:155,pts:50,  col:'#dd2222',det:200,atr:52, adm:15,acd:1.0 },
  shotgunner: { w:28,h:38,hp:55,spd:85, pts:100, col:'#dd7700',det:380,atr:375,adm:11,acd:2.1 },
  knight:     { w:36,h:48,hp:90,spd:210,pts:150, col:'#8833dd',det:310,atr:85, adm:26,acd:1.5 },
};

// ─── TYPES ────────────────────────────────────────────────────────────────────
interface Vec2 { x:number; y:number; }
interface Entity { x:number;y:number;vx:number;vy:number;w:number;h:number;hp:number;maxHp:number; }
interface Platform { id:number;x:number;y:number;w:number;h:number; }

interface Player extends Entity {
  jumps:number; grounded:boolean;
  parryActive:boolean; parryTimer:number; parryFlash:number;
  weapon:number; shootCd:number;
  grapple:boolean; grappleX:number; grappleY:number; grappleOn:boolean;
  inv:number; dead:boolean; facingRight:boolean;
}

interface Enemy extends Entity {
  id:number; type:string; stunned:number; shootCd:number;
  pts:number; dir:number; atkTimer:number; dead:boolean; grounded:boolean;
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
  btype:string; fuse:number; bounced:number;
}

interface Particle {
  id:number; x:number;y:number;vx:number;vy:number;
  life:number;maxLife:number;r:number;g:number;b:number;sz:number;
}

interface GS {
  player: Player;
  enemies: Enemy[];
  boss: Boss | null;
  bullets: Bullet[];
  platforms: Platform[];
  particles: Particle[];
  score: number;
  kills: number;
  bossSpawned: boolean;
  camX: number; camY: number;
  phase: string;
  nextPlatId: number;
  nextEnemyId: number;
  nextBulletId: number;
  nextParticleId: number;
  spawnTimer: number;
  worldRight: number;
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
  spawnParticles(gs,x,y,18,255,160,30,350);
  const radius=110;
  const checkHit=(e:Entity & {hp:number;maxHp:number})=>{
    const cx=e.x+e.w/2, cy=e.y+e.h/2;
    const dist=Math.hypot(cx-x,cy-y);
    if(dist<radius) {
      const dmg=Math.round(60*(1-dist/radius)+10);
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
  const types:Array<string>=['grunt','grunt','shotgunner','grunt','knight','shotgunner','grunt','knight'];
  const type=types[Math.floor(Math.random()*types.length)];
  const cfg=ECFG[type];
  const spawnX=gs.player.x+GW*0.7+randBetween(0,300);
  const plat=gs.platforms.find(p=>p.x<spawnX && p.x+p.w>spawnX-50);
  const spawnY=plat?plat.y-cfg.h:GROUND_Y-cfg.h;
  gs.enemies.push({
    id:gs.nextEnemyId++,type,
    x:spawnX,y:spawnY,vx:0,vy:0,
    w:cfg.w,h:cfg.h,hp:cfg.hp,maxHp:cfg.hp,
    stunned:0,shootCd:randBetween(0,cfg.acd),
    pts:cfg.pts,dir:1,atkTimer:0,dead:false,grounded:false,
  });
}

function spawnBoss(gs:GS) {
  gs.bossSpawned=true;
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
function spawnBullet(gs:GS,x:number,y:number,dx:number,dy:number,fromPlayer:boolean,weaponIdx:number) {
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
      btype:weaponIdx===0?'pistol':weaponIdx===1?'shotgun':'grenade',
      fuse:w.fuse,bounced:0,
    });
  }
}

function spawnEnemyBullet(gs:GS,x:number,y:number,dx:number,dy:number,dmg:number,spread=0.1) {
  const len=Math.hypot(dx,dy)||1;
  const nx=dx/len, ny=dy/len;
  const angle=Math.atan2(ny,nx)+(Math.random()-0.5)*spread;
  gs.bullets.push({
    id:gs.nextBulletId++,
    x,y,vx:Math.cos(angle)*420,vy:Math.sin(angle)*420,
    w:8,h:8,hp:1,maxHp:1,fromPlayer:false,dmg,
    btype:'enemy',fuse:0,bounced:0,
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
  if(e.y+e.h>GROUND_Y+80) { e.y=GROUND_Y+80-e.h; e.vy=0; e.grounded=true; }
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
    grapple:false,grappleX:0,grappleY:0,grappleOn:false,
    inv:0,dead:false,facingRight:true,
  };
  return {
    player, enemies:[], boss:null, bullets:[], platforms:plats, particles:[],
    score:0, kills:0, bossSpawned:false,
    camX:0, camY:0,
    phase:'playing',
    nextPlatId:10, nextEnemyId:0, nextBulletId:0, nextParticleId:0,
    spawnTimer:3, worldRight:1200,
  };
}

// ─── MAIN GAME CANVAS ────────────────────────────────────────────────────────
export default function GameCanvas() {
  const canvasRef=useRef<HTMLCanvasElement>(null);
  const containerRef=useRef<HTMLDivElement>(null);
  const gsRef=useRef<GS>(initGame());
  const keysRef=useRef(new Set<string>());
  const prevKeysRef=useRef(new Set<string>());
  const mouseRef=useRef({x:GW/2,y:GH/2,left:false,right:false,leftClick:false,rightClick:false});
  const [hud,setHud]=useState({score:0,hp:100,weapon:0,kills:0,bossHp:0,bossMaxHp:BOSS_HP,phase:'playing',bossSpawned:false});
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
        // Horizontal
        const moveL=keys.has('KeyA')||keys.has('ArrowLeft');
        const moveR=keys.has('KeyD')||keys.has('ArrowRight');
        if(moveR){ p.vx=PLAYER_SPEED; p.facingRight=true; }
        else if(moveL){ p.vx=-PLAYER_SPEED; p.facingRight=false; }
        else p.vx*=0.85;

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

        // Weapon switch
        if(keys.has('Digit1')&&!prevKeysRef.current.has('Digit1')) p.weapon=0;
        if(keys.has('Digit2')&&!prevKeysRef.current.has('Digit2')) p.weapon=1;
        if(keys.has('Digit3')&&!prevKeysRef.current.has('Digit3')) p.weapon=2;

        // Shoot (left click)
        if(p.shootCd>0) p.shootCd-=dt;
        if(mouse.leftClick && p.shootCd<=0) {
          const worldMouseX=mouse.x+gs.camX;
          const worldMouseY=mouse.y+gs.camY;
          const cx=p.x+p.w/2, cy=p.y+p.h/2;
          spawnBullet(gs,cx,cy,worldMouseX-cx,worldMouseY-cy,true,p.weapon);
          p.shootCd=WEAPONS[p.weapon].cd;
          spawnParticles(gs,cx,cy,2,255,255,100,150);
        }
        mouse.leftClick=false;

        // Grapple (right click)
        if(mouse.rightClick) {
          // Try to latch
          p.grapple=true;
          const worldMouseX=mouse.x+gs.camX;
          const worldMouseY=mouse.y+gs.camY;
          const cx=p.x+p.w/2, cy=p.y+p.h/2;
          const dist=Math.hypot(worldMouseX-cx,worldMouseY-cy);
          if(dist<=GRAPPLE_RANGE) {
            // Check if near platform or within range
            let latched=false;
            for(const plat of gs.platforms) {
              if(aabb(worldMouseX-10,worldMouseY-10,20,20,plat.x,plat.y,plat.w,plat.h)) {
                p.grappleX=worldMouseX; p.grappleY=worldMouseY; p.grappleOn=true; latched=true; break;
              }
            }
            if(!latched && dist<=GRAPPLE_RANGE) {
              p.grappleX=worldMouseX; p.grappleY=worldMouseY; p.grappleOn=true;
            }
          }
          mouse.rightClick=false;
        }
        if(!mouse.right) { p.grapple=false; p.grappleOn=false; }

        // Apply grapple force
        if(p.grappleOn && p.grapple) {
          const cx=p.x+p.w/2, cy=p.y+p.h/2;
          const dx=p.grappleX-cx, dy=p.grappleY-cy;
          const dist=Math.hypot(dx,dy);
          if(dist>30) {
            const fx=dx/dist*GRAPPLE_FORCE, fy=dy/dist*GRAPPLE_FORCE;
            p.vx+=fx*dt; p.vy+=fy*dt;
          } else {
            p.grappleOn=false;
          }
        }

        // Physics
        p.vy+=GRAVITY*dt;
        if(p.vy>MAX_FALL) p.vy=MAX_FALL;
        p.x+=p.vx*dt; p.y+=p.vy*dt;
        p.grounded=false;
        for(const plat of gs.platforms) resolveVsPlat(p,plat);
        if(p.y+p.h>GROUND_Y+80){ p.y=GROUND_Y+80-p.h; p.vy=0; p.grounded=true; }
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

            if(e.type==='grunt') {
              if(distP<cfg.det) {
                e.vx=dxp/Math.abs(dxp||1)*cfg.spd;
                e.facingRight=(dxp>0);
                if(distP<cfg.atr && e.atkTimer<=0) {
                  if(p.parryActive){ e.stunned=1.2; spawnParticles(gs,ex,ey,8,100,200,255,200); }
                  else if(p.inv<=0){ p.hp-=cfg.adm; p.inv=INV_DUR; spawnParticles(gs,px,py,6,255,80,80,150); }
                  e.atkTimer=cfg.acd;
                }
              } else {
                e.vx=e.dir*cfg.spd*0.5;
              }
            } else if(e.type==='shotgunner') {
              if(distP<cfg.det) {
                if(distP>120) e.vx=dxp/Math.abs(dxp||1)*cfg.spd;
                else e.vx*=0.8;
                e.facingRight=(dxp>0);
                e.shootCd-=dt;
                if(e.shootCd<=0 && distP<cfg.atr) {
                  for(let i=0;i<3;i++) spawnEnemyBullet(gs,ex,ey,dxp,dyp,cfg.adm,0.2);
                  e.shootCd=cfg.acd;
                  spawnParticles(gs,ex,ey,4,255,180,50,120);
                }
              } else { e.vx=e.dir*cfg.spd*0.4; }
            } else if(e.type==='knight') {
              if(distP<cfg.det) {
                e.vx=dxp/Math.abs(dxp||1)*cfg.spd*1.1;
                e.facingRight=(dxp>0);
                if(distP<cfg.atr && e.atkTimer<=0) {
                  if(p.parryActive){ e.stunned=1.8; spawnParticles(gs,ex,ey,10,100,200,255,250); }
                  else if(p.inv<=0){ p.hp-=cfg.adm; p.inv=INV_DUR; spawnParticles(gs,px,py,8,255,80,80,180); }
                  e.atkTimer=cfg.acd;
                }
              } else { e.vx=e.dir*cfg.spd*0.5; }
            }

            if(e.atkTimer>0) e.atkTimer-=dt;
          }

          // Physics for enemy
          applyGravAndPlatforms(e,gs.platforms,dt,true);
          // Patrol bounce
          const anyGround=gs.platforms.some(pp=>e.grounded);
          if(!e.grounded && e.type!=='grunt') {
            // push back if off edge
          }
          if(e.x<-500) e.dead=true;
        }

        // Remove dead enemies
        for(const e of gs.enemies) {
          if(e.dead || e.hp<=0) {
            if(!e.dead){ gs.score+=e.pts; gs.kills++; spawnParticles(gs,e.x+e.w/2,e.y+e.h/2,12,200,50,50,220); }
            e.dead=true;
          }
        }
        gs.enemies=gs.enemies.filter(e=>!e.dead);

        // Spawn new enemies
        gs.spawnTimer-=dt;
        if(gs.spawnTimer<=0 && !gs.bossSpawned) {
          const maxEnemies=gs.kills<10?3:5;
          if(gs.enemies.length<maxEnemies) spawnEnemyWave(gs);
          gs.spawnTimer=randBetween(3,6);
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

        // Shoot
        const shootCd=boss.phase===3?0.35:boss.phase===2?0.65:0.9;
        if(boss.shootCd<=0) {
          const weaponChoice=boss.phase===3?Math.floor(Math.random()*3):boss.phase===2?Math.floor(Math.random()*2):0;
          spawnBullet(gs,bx,by,dxp,dyp,false,weaponChoice);
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
        if(boss.y+boss.h>GROUND_Y+80){ boss.y=GROUND_Y+80-boss.h; boss.vy=0; boss.grounded=true; }

        // Boss melee
        if(aabb(boss.x,boss.y,boss.w,boss.h,p.x,p.y,p.w,p.h)) {
          if(p.parryActive){ boss.vy=DJUMP_FORCE; boss.vx*=-2; spawnParticles(gs,bx,by,10,100,200,255,250); }
          else if(p.inv<=0){ p.hp-=20; p.inv=INV_DUR; spawnParticles(gs,px,py2,8,255,80,80,180); }
        }

        if(boss.hp<=0) {
          boss.dead=true;
          gs.score+=1000;
          gs.phase='win';
          spawnParticles(gs,bx,by,30,255,215,0,350);
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

        b.x+=b.vx*dt; b.y+=b.vy*dt;

        // Platform collision for grenades
        if(b.btype==='grenade') {
          for(const plat of gs.platforms) {
            if(aabb(b.x,b.y,b.w,b.h,plat.x,plat.y,plat.w,plat.h) && b.bounced<2) {
              b.vy*=-0.6; b.vx*=0.7; b.bounced++;
            }
          }
        }

        // Bullet lifetime (off screen)
        if(b.x<gs.camX-200 || b.x>gs.camX+GW+200 || b.y<-200 || b.y>GH+200) { b.hp=0; continue; }

        // Hit player
        if(!b.fromPlayer && p.hp>0 && !p.dead) {
          if(aabb(b.x,b.y,b.w,b.h,p.x,p.y,p.w,p.h)) {
            if(p.parryActive) {
              // Deflect
              b.vx*=-1; b.vy*=-1; b.fromPlayer=true; b.btype='pistol';
              spawnParticles(gs,b.x,b.y,6,100,200,255,200);
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
              e.hp-=b.dmg;
              spawnParticles(gs,b.x,b.y,4,200,50,50,150);
              b.hp=0; hitSomething=true;
              if(e.hp<=0){ e.dead=true; gs.score+=e.pts; gs.kills++; spawnParticles(gs,e.x+e.w/2,e.y+e.h/2,12,200,50,50,220); }
              break;
            }
          }
          if(!hitSomething && boss && !boss.dead) {
            if(aabb(b.x,b.y,b.w,b.h,boss.x,boss.y,boss.w,boss.h)) {
              if(boss.parryActive) {
                b.vx*=-1.2; b.vy*=-1.2; b.fromPlayer=false;
                spawnParticles(gs,b.x,b.y,8,255,100,50,200);
              } else {
                boss.hp-=b.dmg;
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
        kills:gs.kills, bossHp:boss?boss.hp:0, bossMaxHp:BOSS_HP,
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
          E: Parry | 1/2/3: Weapons
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
            <div style={{color:'#aaa',fontSize:22,marginBottom:32}}>Kills: {hud.kills}</div>
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
            <div style={{color:'#ccc',fontSize:22,marginBottom:32}}>Kills: {hud.kills}</div>
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

// ─── RENDERER ────────────────────────────────────────────────────────────────
function render(ctx:CanvasRenderingContext2D, gs:GS) {
  const cx=gs.camX, cy=gs.camY;
  const W=ctx.canvas.width, H=ctx.canvas.height;

  // ── Background ──
  ctx.fillStyle='#0a0a1a';
  ctx.fillRect(0,0,W,H);

  // Parallax stars
  ctx.fillStyle='rgba(255,255,255,0.25)';
  const starSeed=17;
  for(let i=0;i<80;i++) {
    const sx=((i*starSeed*137+i*53)%2400)+((cx*0.15)%2400);
    const sy=((i*starSeed*71+i*91)%H);
    ctx.fillRect(sx%W,sy,Math.random()<0.05?2:1,Math.random()<0.05?2:1);
  }

  // Background gradient glow
  const grad=ctx.createLinearGradient(0,0,0,H);
  grad.addColorStop(0,'rgba(10,5,40,0)');
  grad.addColorStop(1,'rgba(20,10,60,0.4)');
  ctx.fillStyle=grad;
  ctx.fillRect(0,0,W,H);

  function wx(x:number){ return x-cx; }
  function wy(y:number){ return y-cy; }

  // ── Platforms ──
  for(const plat of gs.platforms) {
    const px=wx(plat.x), py=wy(plat.y);
    // Glow under platform
    ctx.fillStyle='rgba(80,120,255,0.07)';
    ctx.fillRect(px,py+plat.h,plat.w,8);
    // Main platform
    const pgrad=ctx.createLinearGradient(0,py,0,py+plat.h);
    pgrad.addColorStop(0,'#3a4055');
    pgrad.addColorStop(1,'#1e2235');
    ctx.fillStyle=pgrad;
    ctx.fillRect(px,py,plat.w,plat.h);
    // Top edge highlight
    ctx.fillStyle='rgba(100,130,255,0.45)';
    ctx.fillRect(px,py,plat.w,2);
    // Border
    ctx.strokeStyle='#4a5080';
    ctx.lineWidth=1;
    ctx.strokeRect(px,py,plat.w,plat.h);
  }

  // ── Particles ──
  for(const part of gs.particles) {
    const alpha=part.life/part.maxLife;
    ctx.globalAlpha=alpha;
    ctx.fillStyle=`rgb(${part.r},${part.g},${part.b})`;
    ctx.fillRect(wx(part.x)-part.sz/2, wy(part.y)-part.sz/2, part.sz, part.sz);
  }
  ctx.globalAlpha=1;

  // ── Enemies ──
  for(const e of gs.enemies) {
    if(e.dead) continue;
    const ex=wx(e.x), ey=wy(e.y);
    const cfg=ECFG[e.type];
    const isStunned=e.stunned>0;

    // Glow
    ctx.shadowColor=isStunned?'#88ccff':cfg.col;
    ctx.shadowBlur=isStunned?12:8;
    // Body
    ctx.fillStyle=isStunned?'#5599ff':cfg.col;
    ctx.fillRect(ex,ey,e.w,e.h);
    // Inner highlight
    ctx.fillStyle='rgba(255,255,255,0.15)';
    ctx.fillRect(ex+2,ey+2,e.w-4,6);
    // Eyes
    const eyeDir=e.dir>0?1:-1;
    ctx.fillStyle='#fff';
    ctx.fillRect(ex+e.w/2+eyeDir*4-3,ey+8,6,6);
    ctx.fillStyle='#000';
    ctx.fillRect(ex+e.w/2+eyeDir*5-2,ey+9,4,4);
    // Weapon indicator for shotgunner/knight
    if(e.type==='shotgunner') {
      ctx.fillStyle='#ffaa00';
      ctx.fillRect(ex+(e.dir>0?e.w:- 8),ey+e.h/2-2,8,4);
    }
    if(e.type==='knight') {
      ctx.fillStyle='#cc88ff';
      ctx.fillRect(ex+(e.dir>0?e.w:-12),ey+e.h*0.3,12,5);
    }
    ctx.shadowBlur=0;

    // HP bar above enemy
    if(e.hp<e.maxHp) {
      ctx.fillStyle='#300';
      ctx.fillRect(ex,ey-10,e.w,6);
      ctx.fillStyle='#f00';
      ctx.fillRect(ex,ey-10,e.w*(e.hp/e.maxHp),6);
    }
  }

  // ── Boss ──
  const boss=gs.boss;
  if(boss && !boss.dead) {
    const bx=wx(boss.x), by=wy(boss.y);
    const phaseCols=['#000000','#1a0000','#2d0000'];
    const glowCols=['#ff0000','#ff3300','#ff6600'];
    const pIdx=boss.phase-1;

    // Outer glow (pulsing based on phase)
    const glowSize=boss.phase===3?20+Math.sin(Date.now()*0.008)*8:boss.phase===2?14:10;
    ctx.shadowColor=glowCols[pIdx];
    ctx.shadowBlur=glowSize;

    // Body - BLACK (opposite of white player)
    ctx.fillStyle=phaseCols[pIdx];
    ctx.fillRect(bx,by,boss.w,boss.h);

    // Red border/outline
    ctx.strokeStyle=glowCols[pIdx];
    ctx.lineWidth=boss.phase===3?3:2;
    ctx.strokeRect(bx,by,boss.w,boss.h);

    // Parry flash on boss
    if(boss.parryActive) {
      ctx.fillStyle='rgba(255,50,50,0.35)';
      ctx.fillRect(bx-4,by-4,boss.w+8,boss.h+8);
    }

    // Eyes (glowing red, opposite of white player's dark eyes)
    const eyeDir=boss.facingRight?1:-1;
    ctx.shadowColor='#ff0000';
    ctx.shadowBlur=12;
    ctx.fillStyle='#ff2222';
    ctx.fillRect(bx+boss.w/2+eyeDir*5-3,by+10,7,7);
    ctx.fillStyle='#ff6666';
    ctx.fillRect(bx+boss.w/2+eyeDir*6-2,by+11,4,4);

    // Phase markers
    for(let i=0;i<boss.phase;i++) {
      ctx.fillStyle=glowCols[i];
      ctx.fillRect(bx+5+i*10,by+boss.h-6,7,4);
    }

    ctx.shadowBlur=0;

    // Grapple rope
    if(boss.grappleOn || boss.grapple) {
      ctx.strokeStyle='rgba(180,0,0,0.7)';
      ctx.lineWidth=2;
      ctx.setLineDash([4,4]);
      ctx.beginPath();
      ctx.moveTo(bx+boss.w/2, by+boss.h/2);
      ctx.lineTo(wx(boss.grappleX), wy(boss.grappleY));
      ctx.stroke();
      ctx.setLineDash([]);
      // Hook point
      ctx.fillStyle='#ff3333';
      ctx.fillRect(wx(boss.grappleX)-4,wy(boss.grappleY)-4,8,8);
    }
  }

  // ── Player ──
  const p=gs.player;
  if(!p.dead) {
    const px=wx(p.x), py=wy(p.y);
    const isInv=p.inv>0;
    const isParry=p.parryActive;

    if(!isInv || Math.floor(Date.now()/80)%2===0) {
      // Player glow (WHITE player)
      ctx.shadowColor='#ffffff';
      ctx.shadowBlur=isParry?20:10;

      // Parry flash effect
      if(isParry) {
        ctx.fillStyle='rgba(100,180,255,0.3)';
        ctx.fillRect(px-6,py-6,p.w+12,p.h+12);
      }

      // Body - WHITE
      ctx.fillStyle=isParry?'#aaddff':'#f0f0f0';
      ctx.fillRect(px,py,p.w,p.h);
      // Inner highlight
      ctx.fillStyle='rgba(255,255,255,0.6)';
      ctx.fillRect(px+2,py+2,p.w-4,6);
      // Body detail
      ctx.fillStyle='rgba(0,0,0,0.1)';
      ctx.fillRect(px+4,py+p.h*0.55,p.w-8,p.h*0.3);

      // Eyes - dark on white body
      const eyeDir=p.facingRight?1:-1;
      ctx.shadowBlur=0;
      ctx.fillStyle='#222';
      ctx.fillRect(px+p.w/2+eyeDir*4-3,py+10,6,6);
      ctx.fillStyle='#444';
      ctx.fillRect(px+p.w/2+eyeDir*5-2,py+11,3,3);

      ctx.shadowBlur=0;
    }

    // Grapple rope
    if(p.grappleOn || p.grapple) {
      ctx.strokeStyle='rgba(100,200,255,0.8)';
      ctx.lineWidth=2;
      ctx.setLineDash([5,3]);
      ctx.beginPath();
      ctx.moveTo(px+p.w/2, py+p.h/2);
      ctx.lineTo(wx(p.grappleX), wy(p.grappleY));
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle='#88ddff';
      ctx.beginPath();
      ctx.arc(wx(p.grappleX),wy(p.grappleY),5,0,Math.PI*2);
      ctx.fill();
    }
  }

  // ── Bullets ──
  for(const b of gs.bullets) {
    const bx=wx(b.x), by2=wy(b.y);
    if(b.btype==='grenade') {
      ctx.fillStyle='#66ff00';
      ctx.shadowColor='#66ff00';
      ctx.shadowBlur=8;
      ctx.beginPath();
      ctx.arc(bx+b.w/2,by2+b.h/2,6,0,Math.PI*2);
      ctx.fill();
      // Fuse indicator
      if(b.fuse>0) {
        ctx.strokeStyle='#fff';
        ctx.lineWidth=1.5;
        ctx.beginPath();
        ctx.arc(bx+b.w/2,by2+b.h/2,8,0,Math.PI*2*(1-b.fuse/WEAPONS[2].fuse));
        ctx.stroke();
      }
    } else if(b.fromPlayer) {
      ctx.fillStyle='#ffee44';
      ctx.shadowColor='#ffee44';
      ctx.shadowBlur=6;
      ctx.fillRect(bx,by2,b.btype==='shotgun'?5:7,b.btype==='shotgun'?5:7);
    } else {
      ctx.fillStyle=b.btype==='deflected'?'#44eeff':'#ff4488';
      ctx.shadowColor=ctx.fillStyle;
      ctx.shadowBlur=6;
      ctx.fillRect(bx-1,by2-1,10,10);
    }
    ctx.shadowBlur=0;
  }

  // ── Ground indicator ──
  ctx.fillStyle='rgba(80,120,255,0.15)';
  ctx.fillRect(0,wy(GROUND_Y+80)-2,W,2);
}
