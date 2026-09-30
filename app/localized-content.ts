import type { Country, Topic } from './data';
import { chineseProfiles } from './chinese-content';
import { countryName, regionName, type Locale } from './locale-data';
const kickers: Record<string, string> = { SGP: '小岛连接大世界', JPN: '山海之间的工业与生活', BRA: '森林、农田与城市', TUR: '海峡连接两洲', CHN: '多样地区，紧密生产网络', USA: '联邦、迁移与全球联系', FRA: '欧洲本土与海外世界', IND: '多种语言，多样地区', MYS: '一片海，两大区域', IDN: '跨越群岛的共和国' };
export function profileLabel(country: Country, locale: Locale) {
  return { name: countryName(country.id, country.name, locale), region: regionName(country.region, locale), kicker: locale === 'zh' ? kickers[country.id] ?? country.kicker : country.kicker };
}
export function topicLabel(country: Country, topic: Topic, locale: Locale) {
  return locale === 'zh' ? chineseProfiles[country.id]?.topics[country.topics.findIndex(item => item.id === topic.id)]?.[0] ?? topic.title : topic.title;
}
export const trailZh: Record<string, { title: string; description: string; label: string }> = {
'water-connects': { title: '连接我们的海洋', description: '从海峡到群岛，跟着海路认识彼此相连的地方。', label: '海洋与联系' },
'made-together': { title: '在许多地方制造', description: '看看身边的产品，追踪跨越多个国家的生产故事。', label: '生产与世界' },
'land-shapes-life': { title: '地理塑造生活', description: '从雨林、季风到河流，观察自然如何参与日常生活。', label: '自然与生活' },
};
export const placeZh: Record<string, string> = { 'South Korea':'韩国', 'Sea of Japan':'日本海', 'Mountainous interior':'内陆山地', 'Peru':'秘鲁', 'Argentina':'阿根廷', 'Colombia':'哥伦比亚', 'Portugal':'葡萄牙', 'West Africa':'西非', 'Greece':'希腊', 'Syria':'叙利亚', 'Aegean Sea':'爱琴海', 'Mongolia':'蒙古', 'Eastern coastal belt':'东部沿海地带', 'Gobi':'戈壁', 'Gulf of Mexico':'墨西哥湾', 'Rocky Mountains':'落基山脉', 'United Kingdom':'英国', 'Germany':'德国', 'Spain':'西班牙', 'Belgium':'比利时', 'Italy':'意大利', 'Luxembourg':'卢森堡', 'Pakistan':'巴基斯坦', 'Nepal':'尼泊尔', 'Bangladesh':'孟加拉国', 'Arabian Sea':'阿拉伯海', 'Bay of Bengal':'孟加拉湾', 'Peninsular Malaysia':'马来半岛', 'Sulawesi':'苏拉威西', 'Malaysia':'马来西亚', 'Indonesia':'印度尼西亚', 'Malacca Strait':'马六甲海峡', 'South China Sea':'南海', 'Pacific Ocean':'太平洋', 'Indian Ocean':'印度洋', 'Atlantic Ocean':'大西洋', 'Black Sea':'黑海', 'Mediterranean Sea':'地中海', 'Bosphorus':'博斯普鲁斯海峡', 'Dardanelles':'达达尼尔海峡', 'Anatolia':'安纳托利亚', 'Europe':'欧洲', 'Asia':'亚洲', 'Amazon':'亚马逊', 'Amazon Basin':'亚马逊流域', 'Cerrado':'塞拉多', 'French Guiana':'法属圭亚那', 'Mississippi Basin':'密西西比河流域', 'Himalayas':'喜马拉雅山脉', 'Tibetan Plateau':'青藏高原', 'Eastern plains':'东部平原', 'Pacific coast':'太平洋沿岸', 'Thailand':'泰国', 'Singapore':'新加坡', 'Brunei':'文莱', 'Borneo':'婆罗洲', 'Sumatra':'苏门答腊', 'Java':'爪哇', 'Kalimantan':'加里曼丹', 'New Guinea':'新几内亚', 'Sabah':'沙巴', 'Sarawak':'砂拉越', 'China':'中国', 'Japan':'日本', 'India':'印度', 'Brazil':'巴西', 'France':'法国', 'Turkey':'土耳其', 'United States':'美国', 'Canada':'加拿大', 'Mexico':'墨西哥' };
export const placeName = (name: string, locale: Locale) => locale === 'zh' ? placeZh[name] ?? name : name;
