'use client';

import { useMemo, useState } from 'react';
import { CITY_FOOD_PLACES, nearbyCityFood, type CityFoodPlace } from '@/lib/city-food';
import { searchUrbanDirectory, type UrbanDirectoryEntry } from '@/lib/diorama/urban-directory';
import { projectCityCoordinate } from '@/lib/diorama/city-data';
import type { Place } from '@/lib/places';

const FOOD_CATEGORIES = ['음식점','카페','간편 음식','간편음식','베이커리','바','주점','아이스크림'];
export function CityFoodPanel({place,selectedId,onSelect,onSelectUrban,entries}:{place:Place|null;selectedId:string|null;onSelect:(food:CityFoodPlace)=>void;onSelectUrban:(entry:UrbanDirectoryEntry)=>void;entries:readonly UrbanDirectoryEntry[]}) {
  const [scope,setScope]=useState<'nearby'|'all'>('nearby');
  const [category,setCategory]=useState<'all'|'restaurant'|'cafe'>('all');
  const nearby=useMemo(()=>place?nearbyCityFood(place):[],[place]);
  const available=scope==='all'||!place?CITY_FOOD_PLACES:nearby.map(item=>item.food);
  const shown=available.filter(food=>category==='all'||food.category===category);
  const selected=CITY_FOOD_PLACES.find(food=>food.id===selectedId);
  const local=useMemo(()=>searchUrbanDirectory(entries.filter(entry=>FOOD_CATEGORIES.includes(entry.category)&& (category==='all'||category==='cafe'&&['카페','베이커리'].includes(entry.category)||category==='restaurant'&&!['카페','베이커리','바','주점'].includes(entry.category))), '', place?projectCityCoordinate(place.lng,place.lat):[0,0,0]),[entries,place,category]);
  return <section className="city-food-panel" aria-label="주변 먹거리">
    <span className="diorama-detail-kicker">먹거리도 이야기의 일부</span><h2>{place?`${place.name} 주변 먹거리`:'성남의 먹거리'}</h2>
    <p>선정·소개된 곳은 근거를 함께 보여드려요. 현재 영업과 대기 시간은 가게 안내에서 확인하세요.</p>
    <div className="city-food-filters" role="group" aria-label="먹거리 범위"><button type="button" aria-pressed={scope==='nearby'} disabled={!place} onClick={()=>setScope('nearby')}>주변 3km</button><button type="button" aria-pressed={scope==='all'||!place} onClick={()=>setScope('all')}>성남 전체</button></div>
    <div className="city-food-filters" role="group" aria-label="먹거리 종류">{([{id:'all',label:'전체'},{id:'restaurant',label:'식사'},{id:'cafe',label:'카페'}] as const).map(item=><button type="button" key={item.id} aria-pressed={category===item.id} onClick={()=>setCategory(item.id)}>{item.label}</button>)}</div>
    {selected&&!shown.some(food=>food.id===selected.id)&&<p className="city-story-notice">선택한 {selected.name}은 현재 필터 밖에 있어요. <button type="button" onClick={()=>{setScope('all');setCategory('all');}}>전체에서 보기</button></p>}
    <h3>선정·소개 근거가 있는 곳 <small>{shown.length}곳</small></h3>
    <div className="city-food-list">{shown.map(food=>{
      const distance=nearby.find(item=>item.food.id===food.id)?.distanceMeters;
      return <article key={food.id} data-selected={selectedId===food.id}>
        <span className={`city-food-kind ${food.category}`}>{food.category==='cafe'?'☕ 카페':food.category==='bar'?'◇ 다이닝바':'♨ 식사'}</span>
        <h4>{food.name}</h4><span className="city-food-badge">{food.badge}</span><p>{food.description}</p>
        <p className="city-story-meta">{food.address??`${food.district} ${food.neighborhood} · 상세 주소 확인 전`}{distance!==undefined&&` · 직선 ${(distance/1000).toFixed(1)}km`}</p>
        <div className="city-food-actions"><button type="button" disabled={food.lat===null||food.lng===null} onClick={()=>onSelect(food)}>{food.lat===null?'좌표 확인 전':'지도에서 보기 ↗'}</button><a href={food.sourceUrl} target="_blank" rel="noreferrer">선정·소개 원문 ↗</a></div>
        <p className="city-story-meta">{food.sourceDate?`보도 ${food.sourceDate}`:'선정·게시 날짜 미표시'} · 확인 {food.checkedAt}</p>
      </article>;
    })}</div>
    {!shown.length&&<p className="city-story-notice">이 범위에서 근거가 확인된 먹거리를 아직 찾지 못했어요. 성남 전체를 보거나 아래 주변 가게를 살펴보세요.</p>}
    <h3>공개 지도에 등록된 주변 가게</h3><p className="city-story-meta">{place?.name??'성남 중심'}에서 가까운 순 · 인기 평가가 없는 지도 정보</p>
    <div className="diorama-urban-results">{local.entries.map(entry=><button type="button" key={entry.key} onClick={()=>onSelectUrban(entry)}><span><strong>{entry.name}</strong><small>{entry.category}</small></span><span aria-hidden="true">↗</span></button>)}</div>
    <p className="city-story-meta">직선거리는 도보 경로와 달라요. 길찾기는 가게의 주소로 지도 서비스에서 확인하세요.</p>
  </section>;
}
