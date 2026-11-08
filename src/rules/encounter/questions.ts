/**
 * 内置题库（阶段 2 唯一题源，§8.2 / §8.3）。
 *
 * 出题硬约束：单一确定答案、常识可验证、不涉争议与时效、不出现具体日期 / 版本号 / 人名、
 * 中文陈述句且 ≤ 60 字；hint 只给线索，**不能直接说出答案**。
 */

export type QuestionDifficulty = 'easy' | 'normal' | 'hard';

export interface Question {
  id: string;
  /** 可判对错的陈述句（不是疑问句）。 */
  question: string;
  answer: boolean;
  hint: string;
  difficulty: QuestionDifficulty;
  topic: string;
}

export const QUESTION_MAX_LENGTH = 60;

export const BUILTIN_QUESTIONS: readonly Question[] = [
  // 天文
  { id: 'astro-001', question: '地球围绕太阳公转。', answer: true, hint: '它的轨道周期约等于一个回归年。', difficulty: 'easy', topic: '天文' },
  { id: 'astro-002', question: '月球本身不发光，我们看到的是它反射的太阳光。', answer: true, hint: '夜空中它的亮度会随相位变化。', difficulty: 'easy', topic: '天文' },
  { id: 'astro-003', question: '太阳是一颗行星。', answer: false, hint: '它的质量占整个星系总质量的绝大部分。', difficulty: 'easy', topic: '天文' },
  { id: 'astro-004', question: '光在真空中的传播速度比声音快。', answer: true, hint: '雷雨天总是先看到闪光再听到雷声。', difficulty: 'easy', topic: '天文' },
  { id: 'astro-005', question: '北极星位于南天极附近。', answer: false, hint: '它常被用来辨认北方。', difficulty: 'normal', topic: '天文' },
  { id: 'astro-006', question: '日食发生时，月球位于太阳和地球之间。', answer: true, hint: '此时三者接近一条直线。', difficulty: 'normal', topic: '天文' },
  { id: 'astro-007', question: '太阳系中体积最大的行星是火星。', answer: false, hint: '那颗行星的体积足以装下上千个地球。', difficulty: 'normal', topic: '天文' },
  { id: 'astro-008', question: '月相变化是由月球绕地球公转造成的。', answer: true, hint: '被太阳照亮的部分朝向地球的角度在变。', difficulty: 'normal', topic: '天文' },

  // 地理
  { id: 'geo-001', question: '地球上面积最大的海洋是太平洋。', answer: true, hint: '它的面积超过所有陆地面积之和。', difficulty: 'easy', topic: '地理' },
  { id: 'geo-002', question: '赤道地区终年高温，四季变化不明显。', answer: true, hint: '那里的太阳高度角全年变化很小。', difficulty: 'normal', topic: '地理' },
  { id: 'geo-003', question: '海拔越高，水的沸点越高。', answer: false, hint: '高原上煮饭常需要高压锅。', difficulty: 'normal', topic: '地理' },
  { id: 'geo-004', question: '世界上面积最大的沙漠是撒哈拉沙漠。', answer: false, hint: '全球最干燥的大陆几乎没有降水，也常被归入荒漠。', difficulty: 'hard', topic: '地理' },
  { id: 'geo-005', question: '长江自西向东流入东海。', answer: true, hint: '它的入海口附近有一座大型城市。', difficulty: 'normal', topic: '地理' },
  { id: 'geo-006', question: '地震的震级越大，释放的能量越多。', answer: true, hint: '震级每增加一级，能量相差约三十倍。', difficulty: 'normal', topic: '地理' },
  { id: 'geo-007', question: '地球上的经线都是相互平行的。', answer: false, hint: '它们都汇聚于南北两极。', difficulty: 'normal', topic: '地理' },
  { id: 'geo-008', question: '地球自转一周的时间约为一天。', answer: true, hint: '这造成了昼夜交替。', difficulty: 'easy', topic: '地理' },

  // 生物
  { id: 'bio-001', question: '鲸鱼用肺呼吸。', answer: true, hint: '它需要定期浮到水面换气。', difficulty: 'easy', topic: '生物' },
  { id: 'bio-002', question: '蝙蝠是鸟类。', answer: false, hint: '它的前肢演化成翼膜，体表有毛。', difficulty: 'easy', topic: '生物' },
  { id: 'bio-003', question: '光合作用需要二氧化碳和水。', answer: true, hint: '产物之一是能供生物呼吸的气体。', difficulty: 'normal', topic: '生物' },
  { id: 'bio-004', question: '蘑菇属于植物。', answer: false, hint: '它靠孢子繁殖，不进行光合作用。', difficulty: 'normal', topic: '生物' },
  { id: 'bio-005', question: '人的心脏有四个腔室。', answer: true, hint: '左右各有两个。', difficulty: 'normal', topic: '生物' },
  { id: 'bio-006', question: '血液中的红细胞主要负责运输氧气。', answer: true, hint: '它们含有一种含铁的蛋白质。', difficulty: 'normal', topic: '生物' },
  { id: 'bio-007', question: '所有细菌都对人体有害。', answer: false, hint: '肠道里有很多帮助消化的种类。', difficulty: 'easy', topic: '生物' },
  { id: 'bio-008', question: '蜘蛛属于昆虫。', answer: false, hint: '它的腿比昆虫多两条。', difficulty: 'easy', topic: '生物' },
  { id: 'bio-009', question: '人类的骨骼在成年后仍会不断更新。', answer: true, hint: '旧骨组织被吸收、新骨组织形成。', difficulty: 'hard', topic: '生物' },

  // 物理
  { id: 'phys-001', question: '声音可以在真空中传播。', answer: false, hint: '在太空里无法直接听到爆炸声。', difficulty: 'easy', topic: '物理' },
  { id: 'phys-002', question: '冰的密度小于水，所以冰能浮在水面上。', answer: true, hint: '水结冰时体积会膨胀。', difficulty: 'normal', topic: '物理' },
  { id: 'phys-003', question: '物体的质量会随所在位置的重力变化。', answer: false, hint: '天平在两个地方称出的数值相同。', difficulty: 'normal', topic: '物理' },
  { id: 'phys-004', question: '摩擦力的方向总是与物体运动方向相反。', answer: false, hint: '人走路时，脚受到的摩擦力是向前的。', difficulty: 'hard', topic: '物理' },
  { id: 'phys-005', question: '电流通过导体时会发热。', answer: true, hint: '电暖器利用的就是这一现象。', difficulty: 'easy', topic: '物理' },
  { id: 'phys-006', question: '白光通过棱镜可以分解成多种颜色。', answer: true, hint: '雨后天空中的彩虹与此原理相似。', difficulty: 'easy', topic: '物理' },
  { id: 'phys-007', question: '物体只有在受到外力时才会保持静止或匀速直线运动。', answer: false, hint: '不受外力时它也可以保持原状态。', difficulty: 'hard', topic: '物理' },

  // 化学
  { id: 'chem-001', question: '水在标准大气压下的沸点是 100 摄氏度。', answer: true, hint: '海拔升高时这个温度会降低。', difficulty: 'easy', topic: '化学' },
  { id: 'chem-002', question: '空气中含量最多的气体是氧气。', answer: false, hint: '它约占空气体积的五分之一。', difficulty: 'easy', topic: '化学' },
  { id: 'chem-003', question: '铁在潮湿的空气中容易生锈。', answer: true, hint: '锈的主要成分含有氧元素。', difficulty: 'easy', topic: '化学' },
  { id: 'chem-004', question: '酸溶液能使紫色石蕊试纸变红。', answer: true, hint: '碱性溶液会让它变成另一种颜色。', difficulty: 'normal', topic: '化学' },
  { id: 'chem-005', question: '水和油可以互相溶解。', answer: false, hint: '它们混合后会分成两层。', difficulty: 'easy', topic: '化学' },
  { id: 'chem-006', question: '燃烧需要可燃物、助燃物和达到着火点三个条件。', answer: true, hint: '灭火就是破坏其中至少一个条件。', difficulty: 'normal', topic: '化学' },

  // 数学
  { id: 'math-001', question: '任意三角形的内角和是 180 度。', answer: true, hint: '它与多边形的边数有固定关系。', difficulty: 'easy', topic: '数学' },
  { id: 'math-002', question: '0 是偶数。', answer: true, hint: '它能被 2 整除。', difficulty: 'normal', topic: '数学' },
  { id: 'math-003', question: '两个负数相乘的结果是负数。', answer: false, hint: '同号相乘的结果符号为正。', difficulty: 'normal', topic: '数学' },
  { id: 'math-004', question: '圆的周长与直径的比值是常数。', answer: true, hint: '这个常数约等于 3.14。', difficulty: 'easy', topic: '数学' },

  // 语言与生活
  { id: 'lang-001', question: '「再接再厉」中的「厉」表示严格、猛烈。', answer: true, hint: '这个成语形容继续努力。', difficulty: 'hard', topic: '语言' },
  { id: 'lang-002', question: '「不寒而栗」形容天气非常寒冷。', answer: false, hint: '它形容的是恐惧。', difficulty: 'normal', topic: '语言' },
  { id: 'life-001', question: '冷冻后的食物解冻后不宜反复再冷冻。', answer: true, hint: '反复冻融会影响口感与安全。', difficulty: 'easy', topic: '生活' },
  { id: 'life-002', question: '发生火灾时应乘坐电梯尽快下楼。', answer: false, hint: '电梯井可能成为烟囱。', difficulty: 'easy', topic: '生活' },
  { id: 'life-003', question: '使用与手机电压电流匹配的合格充电器是安全的。', answer: true, hint: '关键在于参数匹配与产品合规。', difficulty: 'normal', topic: '生活' },
  { id: 'life-004', question: '在户外遇到雷雨时，躲在大树下比待在空旷处更安全。', answer: false, hint: '高大的物体更容易被闪电击中。', difficulty: 'normal', topic: '生活' },
];

/** 注入题库的 schema 过滤：非法条目直接丢弃（§8.3）。 */
export function sanitizeQuestions(input: unknown): Question[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: Question[] = [];
  for (const item of input) {
    if (typeof item !== 'object' || item === null) continue;
    const entry = item as Record<string, unknown>;
    const { id, question, answer, hint, difficulty, topic } = entry;
    if (typeof id !== 'string' || id.length === 0 || seen.has(id)) continue;
    if (typeof question !== 'string' || question.length === 0) continue;
    if (question.length > QUESTION_MAX_LENGTH) continue;
    if (typeof answer !== 'boolean') continue;
    if (typeof hint !== 'string' || hint.length === 0) continue;
    if (difficulty !== 'easy' && difficulty !== 'normal' && difficulty !== 'hard') continue;
    if (typeof topic !== 'string' || topic.length === 0) continue;
    seen.add(id);
    out.push({ id, question, answer, hint, difficulty, topic });
  }
  return out;
}
