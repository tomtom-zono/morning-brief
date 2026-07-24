import { describe, it, expect } from 'vitest';
import { checkArticle } from './validate.js';
import { countChars, countBodyChars } from './lib/text.js';
import { findVerbatimOverlap, extractQuotes } from './lib/quotes.js';
import { isUsDst } from './lib/date.js';
import type { Article } from './schema.js';

const URL = 'https://example.com/a';

/** 検証を通る基準記事。各テストはここから1点だけ壊す。 */
function baseArticle(over: Partial<Article> = {}): Article {
  return {
    id: '2026-07-24-boj-jgb',
    theme: '日銀・円金利・JGB',
    title: 'テスト記事',
    summary: 'あ'.repeat(200),
    detail_md: `出典の要約である。[出典](${URL}) ${'い'.repeat(650)}`,
    analysis_md: 'う'.repeat(2100),
    sources: [{ name: '出典', url: URL }],
    ...over,
  };
}

const errorCodes = (a: Article, src: string[] = []) =>
  checkArticle(a, src)
    .issues.filter((i) => i.severity === 'error')
    .map((i) => i.code);

describe('基準記事', () => {
  it('エラーが出ない', () => {
    expect(errorCodes(baseArticle())).toEqual([]);
  });
});

describe('文字数制約 (仕様2.2)', () => {
  it('要約が301字ならエラー', () => {
    expect(errorCodes(baseArticle({ summary: 'あ'.repeat(301) }))).toContain(
      'summary_too_long',
    );
  });

  it('要約がちょうど300字なら通る', () => {
    expect(errorCodes(baseArticle({ summary: 'あ'.repeat(300) }))).not.toContain(
      'summary_too_long',
    );
  });

  it('考察が1999字ならエラー', () => {
    expect(errorCodes(baseArticle({ analysis_md: 'う'.repeat(1999) }))).toContain(
      'analysis_too_short',
    );
  });

  it('考察がちょうど2000字なら通る', () => {
    expect(errorCodes(baseArticle({ analysis_md: 'う'.repeat(2000) }))).not.toContain(
      'analysis_too_short',
    );
  });

  it('URLやMarkdown記号で字数を水増しできない', () => {
    // 2000字に満たない本文をリンクで嵩上げしても通らないこと
    const padded = 'う'.repeat(1500) + ` [link](${URL}) `.repeat(80);
    expect(errorCodes(baseArticle({ analysis_md: padded }))).toContain(
      'analysis_too_short',
    );
  });
});

describe('引用制約 (仕様2.2)', () => {
  it('80字超の直接引用はエラー', () => {
    const long = `本文。[出典](${URL})「${'か'.repeat(100)}」${'い'.repeat(600)}`;
    expect(errorCodes(baseArticle({ detail_md: long }))).toContain('quote_too_long');
  });

  it('出典1件に対し引用2箇所はエラー', () => {
    const two = `[出典](${URL})「短い引用A」ほか「短い引用B」${'い'.repeat(650)}`;
    expect(errorCodes(baseArticle({ detail_md: two }))).toContain('too_many_quotes');
  });

  it('出典1件・引用1箇所は通る', () => {
    const one = `[出典](${URL})「短い引用A」${'い'.repeat(650)}`;
    expect(errorCodes(baseArticle({ detail_md: one }))).not.toContain('too_many_quotes');
  });

  it('原文の30字以上の連続転載を検出する', () => {
    const original =
      '日銀は本日の金融政策決定会合で現行の政策金利を据え置くことを決定したと発表した。';
    const copied = `本文。[出典](${URL}) ${original} ${'い'.repeat(600)}`;
    expect(errorCodes(baseArticle({ detail_md: copied }), [original])).toContain(
      'verbatim_overlap',
    );
  });

  it('自分の言葉で書き直した要約は転載と判定しない', () => {
    const original =
      '日銀は本日の金融政策決定会合で現行の政策金利を据え置くことを決定したと発表した。';
    const paraphrased = `政策金利は今回も変更されなかった。[出典](${URL}) ${'い'.repeat(650)}`;
    expect(errorCodes(baseArticle({ detail_md: paraphrased }), [original])).not.toContain(
      'verbatim_overlap',
    );
  });
});

describe('出典 (仕様2.2)', () => {
  it('出典が空ならエラー', () => {
    expect(errorCodes(baseArticle({ sources: [] }))).toContain('no_sources');
  });

  it('不正なURLはエラー', () => {
    const bad = baseArticle({
      sources: [{ name: 'x', url: 'not-a-url' }],
      detail_md: 'not-a-url ' + 'い'.repeat(650),
    });
    expect(errorCodes(bad)).toContain('bad_source_url');
  });

  it('本文に原文リンクが無ければエラー', () => {
    expect(errorCodes(baseArticle({ detail_md: 'リンクなし本文。' + 'い'.repeat(650) }))).toContain(
      'source_link_missing',
    );
  });
});

describe('字数カウント', () => {
  it('サロゲートペアを1字として数える', () => {
    expect(countChars('𠮷野家')).toBe(3);
    expect('𠮷野家'.length).toBe(4); // String.length は4を返す
  });

  it('Markdown記法とURLを字数から除く', () => {
    expect(countBodyChars(`# 見出し\n\n[リンク](${URL})`)).toBe(
      countChars('見出しリンク'),
    );
  });
});

describe('引用抽出', () => {
  it('鉤括弧とblockquoteを拾う', () => {
    expect(extractQuotes('本文「引用A」\n> 引用B')).toEqual(['引用A', '引用B']);
  });
});

describe('N-gram一致', () => {
  it('短い共通句では誤検知しない', () => {
    expect(findVerbatimOverlap('市場関係者によると', ['市場関係者によると値動きは'])).toEqual([]);
  });
});

describe('米国夏時間判定 (仕様4.7)', () => {
  it('2026年の移行日前後を正しく判定する', () => {
    expect(isUsDst(new Date('2026-03-07T12:00:00Z'))).toBe(false);
    expect(isUsDst(new Date('2026-03-09T12:00:00Z'))).toBe(true);
    expect(isUsDst(new Date('2026-10-31T12:00:00Z'))).toBe(true);
    expect(isUsDst(new Date('2026-11-02T12:00:00Z'))).toBe(false);
  });
});

describe('内容詳細の下限 (実データ試走を受けて error に格上げ)', () => {
  it('600字未満は error として再生成を発火させる', () => {
    const short = baseArticle({ detail_md: `[出典](${URL}) ` + 'い'.repeat(300) });
    expect(errorCodes(short)).toContain('detail_too_short');
  });

  it('600字以上なら通る', () => {
    expect(errorCodes(baseArticle())).not.toContain('detail_too_short');
  });
});

describe('市況データの鮮度判定 (営業日ベース)', () => {
  // marketdata.ts の businessDaysBetween と同じロジックを検証する
  const bizDays = (from: string, to: string): number => {
    const a = new Date(`${from}T00:00:00Z`);
    const b = new Date(`${to}T00:00:00Z`);
    let n = 0;
    const cur = new Date(a);
    while (cur < b) {
      cur.setUTCDate(cur.getUTCDate() + 1);
      const d = cur.getUTCDay();
      if (d !== 0 && d !== 6) n++;
    }
    return n;
  };

  it('平日: 木曜のデータは金曜朝に新鮮(1営業日)', () => {
    expect(bizDays('2026-07-23', '2026-07-24')).toBe(1);
  });

  it('週明け: 金曜のデータは月曜朝も新鮮(1営業日)', () => {
    // 暦日では3日前だが、営業日では1日前。ここを暦日で数えると
    // 毎週月曜のブリーフから数値が消えてしまう。
    expect(bizDays('2026-07-24', '2026-07-27')).toBe(1);
  });

  it('週明け: 木曜のデータは月曜朝には古い(2営業日)', () => {
    expect(bizDays('2026-07-23', '2026-07-27')).toBe(2);
  });

  it('同日は0営業日', () => {
    expect(bizDays('2026-07-24', '2026-07-24')).toBe(0);
  });

  it('7日前(前週金曜→翌週金曜)は5営業日', () => {
    expect(bizDays('2026-07-17', '2026-07-24')).toBe(5);
  });
});

describe('市況CSVのパース (実データで露呈した不具合の回帰テスト)', () => {
  /** marketdata.ts の fetchQuote と同じ抽出ロジック */
  const parse = (csv: string) => {
    const lines = csv.trim().split('\n').filter((l) => l.trim().length > 0);
    const rows: { date: string; value: number }[] = [];
    for (const line of lines.slice(1)) {
      const cols = line.split(',');
      const d = (cols[0] ?? '').trim();
      const v = (cols[1] ?? '').trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
      if (v === '' || v === '.') continue;
      const n = Number(v);
      if (!Number.isFinite(n)) continue;
      rows.push({ date: d, value: n });
    }
    rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    return rows;
  };

  it('空欄行を「値0の観測」として拾わない', () => {
    // Number('') === 0 のため、素朴に書くと空欄が有効値として通る。
    // 実際に33年前(1993年)の原油価格を最新値として採用する不具合が出た。
    const csv = 'observation_date,DCOILWTICO\n1993-05-04,20.4\n2026-07-22,85.10\n2026-07-23,\n';
    const rows = parse(csv);
    expect(rows.length).toBe(2);
    expect(rows[rows.length - 1]!.date).toBe('2026-07-22');
    expect(rows[rows.length - 1]!.value).toBe(85.1);
  });

  it('欠測記号 "." を除外する', () => {
    const csv = 'observation_date,SP500\n2026-07-21,7455.10\n2026-07-22,.\n2026-07-23,7408.30\n';
    const rows = parse(csv);
    expect(rows.length).toBe(2);
    expect(rows[rows.length - 1]!.value).toBe(7408.3);
  });

  it('行順が日付順でなくても最新を正しく選ぶ', () => {
    const csv = 'observation_date,SP500\n2026-07-23,7408.30\n2026-07-21,7455.10\n';
    const rows = parse(csv);
    expect(rows[rows.length - 1]!.date).toBe('2026-07-23');
  });

  it('ヘッダや不正な日付行を無視する', () => {
    const csv = 'observation_date,SP500\nnot-a-date,123\n2026-07-23,7408.30\n';
    const rows = parse(csv);
    expect(rows.length).toBe(1);
  });
});

describe('日銀APIの応答パース (入れ子VALUESの回帰テスト)', () => {
  /**
   * 実応答は VALUES が二重の意味で使われる:
   *   { SERIES_CODE, VALUES: { SURVEY_DATES: [...], VALUES: [...] } }
   * 外側だけを見て「配列でない」と素通りすると、系列が1件も取れない。
   */
  const walkSeries = (json: unknown) => {
    const series: { code: string; dates: string[]; values: (string | number | null)[] }[] = [];
    const walk = (node: unknown, inherited: string): void => {
      if (Array.isArray(node)) {
        for (const n of node) walk(n, inherited);
        return;
      }
      if (!node || typeof node !== 'object') return;
      const o = node as Record<string, unknown>;
      const code = o.SERIES_CODE !== undefined ? String(o.SERIES_CODE) : inherited;
      const sd = o.SURVEY_DATES;
      const vv = o.VALUES;
      if (Array.isArray(sd) && Array.isArray(vv)) {
        series.push({ code, dates: sd.map(String), values: vv as (string | number | null)[] });
        return;
      }
      for (const v of Object.values(o)) walk(v, code);
    };
    walk(json, '');
    return series;
  };

  const realResponse = {
    STATUS: 200,
    RESULTSET: [
      {
        SERIES_CODE: 'FXERD05',
        VALUES: {
          SURVEY_DATES: [20260721, 20260722, 20260723],
          VALUES: [162.51, 163.15, null],
        },
      },
    ],
  };

  it('入れ子のVALUESから系列を取り出せる', () => {
    const s = walkSeries(realResponse);
    expect(s.length).toBe(1);
    expect(s[0]!.code).toBe('FXERD05');
  });

  it('系列コードを親要素から引き継ぐ', () => {
    expect(walkSeries(realResponse)[0]!.code).toBe('FXERD05');
  });

  it('null を除いた最新値を選ぶ', () => {
    const s = walkSeries(realResponse)[0]!;
    const pairs: { date: string; value: number }[] = [];
    for (let i = 0; i < s.dates.length; i++) {
      const v = s.values[i];
      if (v === null || v === undefined) continue;
      const n = Number(String(v).trim());
      if (!Number.isFinite(n)) continue;
      pairs.push({ date: s.dates[i]!, value: n });
    }
    expect(pairs.length).toBe(2);
    expect(pairs[pairs.length - 1]!.value).toBe(163.15);
  });
});

describe('並列プール (時間爆発対策の回帰テスト)', () => {
  const mapPool = async <T, R>(
    items: T[],
    limit: number,
    fn: (item: T, index: number) => Promise<R>,
  ): Promise<R[]> => {
    const results = new Array<R>(items.length);
    let next = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (true) {
        const i = next++;
        if (i >= items.length) return;
        results[i] = await fn(items[i]!, i);
      }
    });
    await Promise.all(workers);
    return results;
  };

  it('完了順に関係なく入力順で結果を返す', async () => {
    // 逆順の遅延を与える: 後の要素ほど早く終わる
    const out = await mapPool([50, 30, 10], 3, async (ms, i) => {
      await new Promise((r) => setTimeout(r, ms));
      return `item${i}`;
    });
    expect(out).toEqual(['item0', 'item1', 'item2']);
  });

  it('同時実行数を上限で抑える', async () => {
    let running = 0;
    let peak = 0;
    await mapPool([1, 2, 3, 4, 5, 6], 2, async () => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 10));
      running--;
    });
    expect(peak).toBeLessThanOrEqual(2);
  });
});
