import * as THREE from './vendor/three.module.js';
import {bodyShape} from './avatar-shape.js';
export function createAvatar(container,initialLevel=1) {
  const renderer=new THREE.WebGLRenderer({alpha:true,antialias:true,powerPreference:'low-power'});
  renderer.setPixelRatio(Math.min(devicePixelRatio||1,2));renderer.setClearColor(0x000000,0);renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.25;
  const canvas=renderer.domElement;canvas.tabIndex=0;canvas.setAttribute('aria-label','3D-персонаж. Проведи пальцем влево или вправо либо используй клавиши со стрелками.');canvas.setAttribute('role','img');container.append(canvas);
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(34,1,.1,30);camera.position.set(0,1.75,6.6);camera.lookAt(0,1.72,0);
  scene.add(new THREE.HemisphereLight(0xeee6ff,0x443e60,2.5));
  const key=new THREE.DirectionalLight(0xffe9d6,3.2);key.position.set(-3,5,4);scene.add(key);
  const rim=new THREE.DirectionalLight(0xa599ff,3);rim.position.set(3,3,-3);scene.add(rim);
  const character=new THREE.Group();character.rotation.y=-.23;scene.add(character);
  const skin=new THREE.MeshStandardMaterial({color:0xcc997b,roughness:.78});
  const shadowSkin=new THREE.MeshStandardMaterial({color:0xae7d67,roughness:.85});
  const shorts=new THREE.MeshStandardMaterial({color:0x555275,roughness:.9});
  const hair=new THREE.MeshStandardMaterial({color:0x332c2c,roughness:1});
  const eye=new THREE.MeshStandardMaterial({color:0x292326,roughness:.5});
  const shoe=new THREE.MeshStandardMaterial({color:0xd9d8e5,roughness:.8});
  const sphere=new THREE.SphereGeometry(1,28,20);
  function ellipsoid(material,position,scale,parent=character){const mesh=new THREE.Mesh(sphere,material);mesh.position.set(...position);mesh.scale.set(...scale);parent.add(mesh);return mesh;}
  const torso=new THREE.Mesh(new THREE.LatheGeometry([new THREE.Vector2(.31,1.34),new THREE.Vector2(.35,1.50),new THREE.Vector2(.40,1.72),new THREE.Vector2(.39,1.95),new THREE.Vector2(.42,2.16),new THREE.Vector2(.38,2.30),new THREE.Vector2(.23,2.43),new THREE.Vector2(.13,2.52)],40),skin);torso.scale.z=.72;character.add(torso);
  const chestL=ellipsoid(skin,[-.19,2.14,.25],[.21,.13,.055]);
  const chestR=ellipsoid(skin,[.19,2.14,.25],[.21,.13,.055]);
  ellipsoid(skin,[0,2.57,0],[.13,.20,.14]);
  ellipsoid(skin,[0,2.95,0],[.285,.365,.27]);
  const cap=ellipsoid(hair,[0,3.19,-.018],[.29,.17,.27]);cap.rotation.x=-.13;
  ellipsoid(hair,[-.19,3.17,.15],[.15,.12,.15]);
  for(const side of [-1,1]) {
    ellipsoid(skin,[side*.286,2.96,0],[.056,.09,.05]);
    ellipsoid(eye,[side*.105,3.005,.249],[.023,.032,.018]);
    const eyebrow=ellipsoid(hair,[side*.105,3.075,.249],[.06,.012,.015]);eyebrow.rotation.z=side*-.07;
  }
  ellipsoid(skin,[0,2.94,.26],[.042,.06,.06]);
  const smile=new THREE.Mesh(new THREE.TorusGeometry(.062,.008,6,24,Math.PI*.72),shadowSkin);smile.rotation.z=Math.PI*1.14;smile.position.set(0,2.855,.253);character.add(smile);
  const navel=ellipsoid(shadowSkin,[0,1.66,.29],[.012,.018,.005]);
  const arms=[];const legs=[];const shoulders=[];
  for(const side of [-1,1]) {
    const shoulder=ellipsoid(skin,[side*.44,2.23,0],[.18,.20,.20]);shoulders.push({mesh:shoulder,side});
    const arm=new THREE.Group();arm.position.set(side*.48,2.22,0);arm.rotation.z=side*.13;character.add(arm);
    const upper=ellipsoid(skin,[0,-.28,0],[.115,.31,.125],arm);
    const lower=ellipsoid(skin,[0,-.73,.025],[.10,.27,.11],arm);
    ellipsoid(skin,[0,-1,.025],[.095,.13,.07],arm);arms.push({group:arm,upper,lower,side});
    const leg=ellipsoid(skin,[side*.19,.65,0],[.145,.49,.16]);legs.push(leg);
    const pantLeg=new THREE.Mesh(new THREE.CylinderGeometry(.195,.185,.43,24),shorts);pantLeg.position.set(side*.185,1.12,0);pantLeg.scale.z=1.13;character.add(pantLeg);
    ellipsoid(shoe,[side*.20,.15,.08],[.16,.13,.28]);
  }
  const waistband=new THREE.Mesh(new THREE.CylinderGeometry(.35,.37,.20,32),shorts);waistband.position.set(0,1.36,0);waistband.scale.z=.80;character.add(waistband);
  const abs=[];
  for(let row=0;row<3;row++)for(const side of [-1,1])abs.push(ellipsoid(skin,[side*.09,1.98-row*.13,.21],[.073,.059,.024]));
  const stand=new THREE.Mesh(new THREE.CylinderGeometry(.90,1,.055,64),new THREE.MeshStandardMaterial({color:0x373348,roughness:1}));stand.position.y=-.005;scene.add(stand);
  const ring=new THREE.Mesh(new THREE.TorusGeometry(.96,.011,8,80),new THREE.MeshBasicMaterial({color:0xa394cf}));ring.rotation.x=Math.PI/2;ring.position.y=.025;scene.add(ring);
  let active=false,frame=null,angle=-.23,drag=null,previousLevel,disposed=false;
  const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
  function render(time=0){if(disposed)return;character.rotation.y=angle;character.position.y=reduced?0:Math.sin(time*.0017)*.006;renderer.render(scene,camera);if(active&&!document.hidden&&!reduced)frame=requestAnimationFrame(render);else frame=null;}
  function draw(){if(!frame)render(performance.now());}
  function setLevel(level){if(previousLevel===level)return;previousLevel=level;const shape=bodyShape(level);const t=shape.trained;const points=[[.31,1.34],[.35-.07*t,1.50],[.40-.13*t,1.72],[.39-.06*t,1.95],[.42+.08*t,2.16],[.38+.06*t,2.30],[.23,2.43],[.13,2.52]].map(([r,y])=>new THREE.Vector2(r,y));torso.geometry.dispose();torso.geometry=new THREE.LatheGeometry(points,40);navel.position.z=(.40-.13*t)*.72+.004;for(const chest of [chestL,chestR]){chest.visible=t>.2;chest.position.z=.25+t*.04;chest.scale.set(.21+t*.03,.13+t*.01,.055+t*.01);}for(const shoulder of shoulders){shoulder.mesh.position.x=shoulder.side*shape.shoulders;shoulder.mesh.scale.set(.18+shape.trained*.065,.20+shape.trained*.02,.20+shape.trained*.03);}for(const arm of arms){arm.group.position.x=arm.side*(shape.shoulders+.04);arm.upper.scale.set(shape.arm,.31,shape.arm*1.08);arm.lower.scale.set(.10+shape.trained*.04,.27,.11+shape.trained*.025);}for(const leg of legs){leg.scale.x=shape.leg;leg.scale.z=.16+shape.trained*.025;}for(const mesh of abs)mesh.visible=shape.trained>.45;canvas.dataset.level=level;canvas.dataset.stage=shape.stage;draw();}
  function resize(){const {width,height}=container.getBoundingClientRect();if(!width||!height)return;renderer.setSize(width,height,false);camera.aspect=width/height;camera.updateProjectionMatrix();draw();}
  const observer=new ResizeObserver(resize);observer.observe(container);
  canvas.addEventListener('pointerdown',event=>{drag={id:event.pointerId,x:event.clientX,angle};canvas.setPointerCapture(event.pointerId);});
  canvas.addEventListener('pointermove',event=>{if(drag&&drag.id===event.pointerId){angle=drag.angle+(event.clientX-drag.x)*.015;canvas.dataset.rotation=angle;draw();}});
  function finish(){drag=null;}canvas.addEventListener('pointerup',finish);canvas.addEventListener('pointercancel',finish);
  canvas.addEventListener('keydown',event=>{if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();angle+=event.key==='ArrowLeft'?-.35:.35;draw();}});
  canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();container.dataset.unavailable='true';});
  function visibility(){if(document.hidden){if(frame)cancelAnimationFrame(frame);frame=null;}else draw();}document.addEventListener('visibilitychange',visibility);
  setLevel(initialLevel);resize();container.dataset.ready='true';
  return {setLevel,setActive(value){active=value;if(!active&&frame){cancelAnimationFrame(frame);frame=null;}if(value){resize();draw();}},rotate(delta){angle+=delta;draw();},reset(){angle=-.23;draw();}};
}
