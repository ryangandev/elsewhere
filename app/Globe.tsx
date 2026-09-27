'use client';
import { useEffect, useRef, useState } from 'react';
import type { GlobeInstance } from 'globe.gl';
import { countries, type Country, type Topic } from './data';
export type GlobeAction = { type: 'in' | 'out' | 'home' | 'north'; seq: number };
const duration = (ms:number) => window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : ms;
export default function GlobeView({country,topic,onSelect,action,onReady,onUnknown}:{country:Country|null;topic:Topic|null;onSelect:(id:string)=>void;action:GlobeAction;onReady:()=>void;onUnknown:(name:string,lat:number,lng:number)=>void}) {
 const host=useRef<HTMLDivElement>(null); const globe=useRef<GlobeInstance|null>(null); const callbacks=useRef({onSelect,onReady,onUnknown}); callbacks.current={onSelect,onReady,onUnknown}; const [error,setError]=useState(false); const [loaded,setLoaded]=useState(false);
 const features=useRef<any[]>([]);
 useEffect(()=>{let disposed=false;let ro:ResizeObserver; const init=async()=>{try{
 const [{default:Globe},geo]=await Promise.all([import('globe.gl'),fetch('/maps/countries.geojson').then(r=>{if(!r.ok)throw Error('Map unavailable');return r.json() as Promise<{features:any[]}>})]);if(disposed||!host.current)return;
 features.current=geo.features; const el=host.current;
 const g=new Globe(el,{animateIn:false,rendererConfig:{antialias:true,alpha:true}}).width(el.clientWidth).height(el.clientHeight).backgroundColor('rgba(0,0,0,0)').globeImageUrl('/maps/earth.jpg').showAtmosphere(true).atmosphereColor('#7badce').atmosphereAltitude(.14).polygonsData(geo.features).polygonAltitude(.002).polygonCapColor(()=>'rgba(0,0,0,0)').polygonSideColor(()=>'rgba(0,0,0,0)').polygonStrokeColor(()=>'rgba(204,219,205,0.23)').polygonsTransitionDuration(300).polygonLabel((d:any)=>{const c=countries.find(c=>c.id===d.properties.ADM0_A3);return `<div class="map-tooltip">${c?c.flag+' ':''}${d.properties.ADMIN}${c?'<small>Click to explore</small>':''}</div>`}).onPolygonClick((d:any)=>{const c=countries.find(c=>c.id===d.properties.ADM0_A3);if(c)callbacks.current.onSelect(c.id);else {g.pointOfView({lat:d.properties.LABEL_Y,lng:d.properties.LABEL_X,altitude:1.4},duration(900));callbacks.current.onUnknown(d.properties.ADMIN,d.properties.LABEL_Y,d.properties.LABEL_X);}});
 globe.current=g;g.pointOfView({lat:18,lng:87,altitude:2.05});g.controls().enablePan=false;g.controls().minDistance=120;g.controls().maxDistance=600;g.controls().autoRotate=false;g.controls().rotateSpeed=.5;g.controls().zoomSpeed=.6;
 g.htmlElementsData(countries).htmlLat('lat').htmlLng('lng').htmlAltitude(.015).htmlElement((d:any)=>{const b=document.createElement('button');b.className='globe-pin';b.setAttribute('aria-label',`Explore ${d.name}`);const dot=document.createElement('span');dot.className='pin-dot';b.appendChild(dot);b.appendChild(document.createTextNode(d.name));b.onclick=(e)=>{e.stopPropagation();callbacks.current.onSelect(d.id)};return b;});
 ro=new ResizeObserver(()=>{g.width(el.clientWidth).height(el.clientHeight)});ro.observe(el);
 g.onGlobeReady(()=>{if(!disposed){setLoaded(true);callbacks.current.onReady()}});
 }catch(e){console.error(e);if(!disposed)setError(true)}};init();return()=>{disposed=true;ro?.disconnect();globe.current?._destructor();globe.current=null;};},[]);
 useEffect(()=>{const g=globe.current;if(!g||!loaded)return;
 if(country){g.pointOfView(topic?.view ?? {lat:country.lat,lng:country.lng,altitude:country.altitude},duration(1400));g.polygonCapColor((d:any)=>d.properties.ADM0_A3===country.id?'rgba(161,204,141,0.28)':country.neighbors.some(n=>n.kind==='country'&&n.name===d.properties.ADMIN)?'rgba(187,206,173,0.07)':'rgba(0,0,0,0)').polygonStrokeColor((d:any)=>d.properties.ADM0_A3===country.id?'#d2e4a5':'rgba(204,219,205,0.2)');}
 else {g.pointOfView({lat:18,lng:87,altitude:2.05},duration(1300));g.polygonCapColor(()=>'rgba(0,0,0,0)').polygonStrokeColor(()=>'rgba(204,219,205,0.23)');}
 const data=country?[country,...(topic?.places||country.neighbors)]:countries;
 g.htmlElementsData(data).htmlElement((d:any)=>{const b=document.createElement(d.id?'button':'div');b.className=`globe-pin ${d.id===country?.id?'active':''} ${d.kind==='water'?'water-label':''} ${!d.id?'context-label':''}`;if(d.id){b.setAttribute('aria-label',`Explore ${d.name}`);const dot=document.createElement('span');dot.className='pin-dot';b.appendChild(dot);b.onclick=(e)=>{e.stopPropagation();callbacks.current.onSelect(d.id)}}b.appendChild(document.createTextNode(d.name));return b;});
 const route=topic?.route;g.pathsData(route?[route]:[]).pathPoints(d=>d as any).pathPointLat((d:any)=>d[0]).pathPointLng((d:any)=>d[1]).pathPointAlt(.012).pathColor(()=>'#e6dba1').pathStroke(2).pathDashLength(.07).pathDashGap(.018).pathDashAnimateTime(duration(22000)).pathTransitionDuration(800);
 },[country,topic,loaded]);
 useEffect(()=>{const g=globe.current;if(!g||!action.seq)return;const pov=g.pointOfView();if(action.type==='in')g.pointOfView({...pov,altitude:Math.max(.22,pov.altitude*.78)},duration(400));if(action.type==='out')g.pointOfView({...pov,altitude:Math.min(4.5,pov.altitude*1.22)},duration(400));if(action.type==='north')g.pointOfView({...pov,lat:country?.lat||18},duration(500));if(action.type==='home')g.pointOfView({lat:18,lng:87,altitude:2.05},duration(1200));},[action,country]);
 return <div className="globe-render" ref={host} aria-label="Interactive 3D world globe">{error&&<div className="globe-error"><strong>The globe couldn’t load.</strong><p>You can still explore the country stories.</p><button onClick={()=>location.reload()}>Try again</button></div>}</div>;
}
