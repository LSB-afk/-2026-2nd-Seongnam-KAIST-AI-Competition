import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CityFoodPanel } from '../src/components/diorama/city-food-panel';
import { CITY_FOOD_PLACES } from '../src/lib/city-food';
import urbanIndex from '../src/lib/diorama/seongnam-urban-index.json';
import { createUrbanDirectory, type UrbanIndex } from '../src/lib/diorama/urban-directory';
import { getPlace } from '../src/lib/places';

const entries = createUrbanDirectory(urbanIndex as unknown as UrbanIndex);
const render = (placeId: string | null) => renderToStaticMarkup(createElement(CityFoodPanel, {
  place: placeId ? getPlace(placeId)! : null, selectedId: null, onSelect: () => {}, onSelectUrban: () => {}, entries,
}));
const mapCategories = (html: string) => [...html.matchAll(/<small>([^<]*)<\/small>/g)].map(match => match[1]);

describe('food panel for the youth audience', () => {
  it('leaves bars and pubs out of the nearby public-map list', () => {
    const html = render('central-park');
    expect(html).toContain('중앙공원 주변 먹거리');
    const categories = mapCategories(html.slice(html.indexOf('diorama-urban-results')));
    expect(categories.length).toBeGreaterThan(0);
    expect(categories).not.toContain('바');
    expect(categories).not.toContain('주점');
    expect(html).not.toContain('뮤즈단란주점');
    expect(html).not.toContain('하남장 돼지집');
  });

  it('leaves curated bars out of the city-wide list', () => {
    const html = render(null);
    expect(html).toContain('성남의 먹거리');
    for (const food of CITY_FOOD_PLACES) {
      if (food.category === 'bar') expect(html).not.toContain(food.name);
      else expect(html).toContain(food.name);
    }
  });
});
