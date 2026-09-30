'use client';
import { useEffect, useRef } from 'react';
import { ArrowUpRight, Compass } from 'lucide-react';
import type { Country, Topic } from './data';
import type { Destination, MapCountry } from './exploration';
import { countryBasics, countryName, regionName, useLocale } from './locale';
import { chineseProfiles } from './chinese-content';
const source = 'https://www.naturalearthdata.com/downloads/10m-cultural-vectors/10m-admin-0-countries/';
export default function CountryOverview({ country, profile, topic, onNavigate }: { country: MapCountry; profile: Country | null; topic: Topic | null; onNavigate: (destination: Destination) => void }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, [country.id, topic?.id]);
  const { locale } = useLocale();
  const zh = locale === 'zh';
  const name = countryName(country.id, country.name, locale);
  const facts = countryBasics[country.id];
  const edited = zh && profile ? chineseProfiles[country.id] : null;
  const questionIndex = profile?.topics.findIndex(item => item.id === topic?.id) ?? -1;
  const question = questionIndex >= 0 ? edited?.topics[questionIndex] : null;
  const hemisphere = `${Math.abs(country.lat).toFixed(1)}°${country.lat >= 0 ? 'N' : 'S'}, ${Math.abs(country.lng).toFixed(1)}°${country.lng >= 0 ? 'E' : 'W'}`;
  const questions = zh ? [
    [`${name}在哪里？`, `先在地球上找到${name}，再观察它在${regionName(country.region, locale)}的位置。缩放与旋转地图，比较海岸、岛屿与周边地理形状。地图标记是地理定位点，并非首都。`],
    ['地理可能怎样影响生活？', '从地图提出假设：海洋、山地或边界可能怎样影响交通与联系？这是一项观察练习，不能仅凭轮廓推断经济、文化或政治。'],
    ['接下来应核实哪些资料？', '比较官方统计、当地政府或博物馆资料。记录资料年份，区分国家、地区与地图单元，并留意不同资料的名称与边界口径。'],
  ] : [
    [`Where is ${name}?`, `Locate ${name} in ${country.region}. Rotate and zoom to compare coastlines, islands and nearby shapes. The map anchor is a location reference, not a capital.`],
    ['How might geography shape everyday life?', 'Use the map to form questions about transport and connections. A shape alone cannot establish economic, cultural or political facts.'],
    ['What should I verify next?', 'Compare official statistics, local government and museum sources. Record publication years and distinguish countries, territories and cartographic units.'],
  ];
  return <>
    <div className="country-region">{regionName(country.region, locale)}<span>· {edited ? zh ? '编辑概览' : 'EDITED OVERVIEW' : zh ? '基础地理概览' : 'BASIC OVERVIEW'}</span></div>
    {question ? <><button className="back-link" onClick={() => onNavigate({ countryId: country.id })}>{name} · 返回概览</button><h2 ref={heading} tabIndex={-1} className="topic-heading">{question[0]}</h2><p className="topic-intro">{question[1]}</p><p className="source-note">中文为本版英文编辑内容的精简摘要，沿用原问题的来源。可切换 English 阅读完整英文内容。</p></> : <>
    <h2 ref={heading} tabIndex={-1} className="country-title"><span>{profile?.flag}</span>{name}</h2>
    {zh && <p className="native-name">{country.name}</p>}
    <p className="country-summary">{edited?.summary ?? (zh ? `${name}是地图收录的国家或地区单元，位于${regionName(country.region, locale)}。下列资料来自随应用打包的 Natural Earth 数据，可用于建立初步地理认识。` : `${name} is a country or territory unit in the bundled map, located in ${country.region}. The Natural Earth reference below provides a starting point for geographic exploration.`)}</p>
    <div className="quick-facts"><div><span>{zh ? '地理区域' : 'REGION'}</span><strong>{regionName(country.region, locale)}</strong></div><div><span>{zh ? '地图定位点' : 'MAP ANCHOR'}</span><strong>{hemisphere}</strong></div></div>
    {edited && profile ? <div className="reference-population"><span>人口参考 · 2024</span><strong>{profile.population.includes('billion') ? `${parseFloat(profile.population) * 10}亿` : `${parseFloat(profile.population) * 100}万`}</strong><small>本版编辑资料，非实时统计。来源见下方。</small></div> : facts?.population !== null && facts?.populationYear && <div className="reference-population"><span>{zh ? '人口估计' : 'Population estimate'} · {facts.populationYear}</span><strong>{new Intl.NumberFormat(zh ? 'zh-CN' : 'en').format(facts.population!)}</strong><small>{zh ? 'Natural Earth 历史参考，非实时统计；地区统计口径可能不同。' : 'Historical Natural Earth reference, not live statistics; territorial definitions may vary.'}</small></div>}
    {edited && <><p className="country-summary">{edited.geography}</p><details className="small-details"><summary>基本资料 · 本版2024年参考</summary><dl><div><dt>首都</dt><dd>{edited.capital}</dd></div><div><dt>语言</dt><dd>{edited.language}</dd></div><div><dt>货币</dt><dd>{edited.currency}</dd></div></dl><p>本版参考资料并非实时更新。请在来源中核对日期与口径。</p></details><section className="topics" id="curiosity-topics"><div className="topics-heading"><h4>顺着好奇心继续</h4><span>编辑问题</span></div>{edited.topics.map(([title], index) => <button key={profile!.topics[index].id} onClick={() => onNavigate({ countryId: country.id, topicId: profile!.topics[index].id })}><span>{title}</span><ArrowUpRight size={18} /></button>)}</section></>}
    {!edited && <p className="location-note">{zh ? '此处尚无深度编辑故事。我们只提供可溯源的基础地理资料，不推测首都、语言、文化或最新政治状态。' : 'A deeper editorial story is not yet available. This overview offers sourced geographic basics; it does not infer capitals, languages, culture or current political status.'}</p>}
    </>}
    <section className="learning-prompts"><div className="section-label"><Compass size={14} />{zh ? '继续学习 · 静态引导' : 'KEEP LEARNING · STATIC GUIDES'}</div>{questions.map(([title, answer]) => <details className="small-details" key={title}><summary>{title}</summary><p>{answer}</p></details>)}</section>
    <details className="small-details"><summary>{zh ? '来源与内容范围' : 'Sources & coverage'}</summary><p>{zh ? '地图含258个国家和地区标识，并不等于258个主权国家。边界和名称用于探索，不代表领土主张。人口数据保留原始年份；基础数据没有实时更新，也没有AI生成回答。' : 'The map contains 258 country and territory identities, not 258 sovereign states. Names and boundaries are for exploration and do not endorse territorial claims. Population retains its source year. These are static references and guides, without live updates or AI answers.'}</p><a href={source} target="_blank" rel="noreferrer">Natural Earth · Admin 0 <ArrowUpRight size={12} /></a>{(topic?.sources ?? profile?.sources ?? []).map(item => <a key={item.url} href={item.url} target="_blank" rel="noreferrer">{item.name}<ArrowUpRight size={12} /></a>)}</details>
  </>;
}
