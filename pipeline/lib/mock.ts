/**
 * MB_MOCK=1 用の決定的スタブ。
 *
 * 目的は「APIキー無しで検証器を通す」ことではなく、「検証器が実際に働くことを
 * 示す」こと。したがって出力は仕様2.2の字数・出典・引用制約を実際に満たす
 * 日本語テキストとして組み立てる。ダミー数値は入れない(仕様2.4の正確性制約に
 * 倣い、モックでも捏造数値を書かない)。
 */

const THEME_POINTS: Record<string, string[]> = {
  default: [
    '価格形成の背景にある資金フローの担い手が誰であったかを特定する作業',
    '一次情報の公表スケジュールと市場の織り込み度合いのずれ',
    '取引時間帯ごとの流動性の偏りが値動きの解釈に与えるバイアス',
    '関連資産間の相関が平時の想定から乖離している局面での波及経路',
  ],
};

function points(theme: string): string[] {
  return THEME_POINTS[theme] ?? THEME_POINTS.default!;
}

/** 指定字数以上になるまで、論点を並べた日本語段落を積む。 */
function buildAnalysis(theme: string, minChars: number): string {
  const p = points(theme);
  const blocks: string[] = [];

  blocks.push(`## 3ペルソナへの含意\n`);
  blocks.push(
    `ヘッジファンドのアナリストにとって、本件は個別銘柄の業績見通しそのものよりも、` +
      `セクター内での相対評価の前提が動いたかどうかという観点で読むべき材料とみられる。` +
      `決算期をまたぐ局面では、同一セクター内でも資金調達構造の違いによって影響の出方が` +
      `分かれるため、単純なセクター一括の評価では取りこぼしが生じる可能性がある。` +
      `${theme}に関する材料は、往々にして初期反応と数日後の定着した価格形成が異なる。\n\n`,
  );
  blocks.push(
    `円金利トレーダーにとっては、イールドカーブのどの年限に影響が集中するかが論点となる。` +
      `短期ゾーンは政策金利の予想経路に、超長期ゾーンは投資家の年限選好と需給に規定される` +
      `度合いが大きく、同じ材料でも年限によって反応が逆方向になり得る点に留意が必要である。` +
      `クロスカレンシーベーシスの水準は、海外投資家の為替ヘッジ後利回りを通じて` +
      `国債需要に波及するため、国内要因のみで説明しようとすると解釈を誤る恐れがある。\n\n`,
  );
  blocks.push(
    `日本株ストラテジストにとっては、本件を単発のイベントとしてではなく、` +
      `資金フローの構造変化の一部として位置づけられるかが問われる。` +
      `海外投資家の売買動向は週次の公表データで事後的にしか確認できないため、` +
      `公表までの期間は先物と現物の乖離やセクターローテーションの形状から` +
      `間接的に推定する作業が必要になるとみられる。\n\n`,
  );

  blocks.push(`## 今後の潮流として拡張して考えられる論点\n`);
  blocks.push(
    `現時点で確認できる情報は限定的であり、以下は事実ではなく解釈である。` +
      `第一に、今回の材料が一過性の需給要因によるものか、より持続的な期待の変化を` +
      `反映したものかは、次回の関連統計の公表を待って初めて判別可能になる。` +
      `第二に、市場参加者の多くが同じ方向にポジションを傾けている場合、` +
      `材料そのものの重要度に比して価格変動が増幅されることがある。` +
      `第三に、制度変更を伴う論点では、実施時期と市場の織り込み時期にずれが生じやすく、` +
      `その間隙が短期的な歪みとして現れる可能性がある。\n\n`,
  );

  blocks.push(`## 見落とされがちだがキャッチアップすべき論点\n`);
  for (const [i, pt] of p.entries()) {
    blocks.push(
      `(${i + 1}) ${pt}。この点は日次のニュースフローでは扱われにくいが、` +
        `ポジショニングの偏りが解消される局面では価格形成の主因となり得る。` +
        `具体的には、先物の建玉動向、オプションの建玉分布とガンマの符号、` +
        `裁定残高の水準といった需給指標を併せて確認することで、` +
        `ニュースの見出しからは読み取れない需給の実態に接近できるとみられる。` +
        `これらの指標は公表頻度が異なるため、時系列を揃えて比較する際には` +
        `集計基準の差異に注意する必要がある。\n\n`,
    );
  }

  blocks.push(
    `なお、本節の記述のうち情報源に明示されていない部分は解釈であり、` +
      `断定的な予測ではない。数値については取得できた範囲に限定しており、` +
      `確認できなかった系列は未確認として扱っている。\n`,
  );

  let out = blocks.join('');
  // 字数が足りない場合は論点を追加して密度を上げる(冗長な繰り返しは避ける)。
  let extra = 0;
  while (countLoose(out) < minChars + 150 && extra < 12) {
    out +=
      `\n補足(${extra + 1}): ${theme}を評価する際、` +
      `同一の材料でも投資家層によって解釈が異なる点は軽視されやすい。` +
      `国内実需筋、海外マクロファンド、パッシブ資金では投資期間と制約条件が異なり、` +
      `結果として同じニュースに対する反応速度と方向が一致しない。` +
      `この非対称性は、イベント直後の値動きよりもその後の数営業日の` +
      `値動きの持続性に現れやすいとみられる。\n`;
    extra++;
  }
  return out;
}

/** text.ts の countBodyChars と同等の概算(循環importを避けるため簡易版)。 */
function countLoose(md: string): number {
  const s = md
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/^[ \t]*[#>\-*+]+[ \t]*/gm, '')
    .replace(/[*_`~]/g, '')
    .replace(/\s+/g, '');
  return Array.from(s).length;
}

export function mockArticle(theme: string, attempt: number): string {
  const url = `https://example.com/mock/${encodeURIComponent(theme)}`;
  const summary =
    `${theme}に関する材料が伝わった。現時点で確認できる情報は限定的であり、` +
    `数値の詳細は未確認である。重要なのは、この材料が一過性の需給要因によるものか、` +
    `より持続的な期待の変化を反映したものかという点であり、` +
    `本稿では3ペルソナそれぞれの観点から含意を整理し、` +
    `需給・ポジショニングの側面から見落とされやすい論点を扱う。`;

  const detail =
    `本節は取得した情報源に基づく自分の言葉での要約である。\n\n` +
    `[モック情報源](${url})によれば、${theme}に関連する動きが報じられた。` +
    `報道の要点は、市場参加者の関心が特定の論点に集中しつつあるという指摘にある。` +
    `ただし本モックでは具体的な数値は提供されていないため、水準や騰落率は未確認として扱う。\n\n` +
    `一次情報にあたる公表資料では、公表スケジュールと市場の織り込みのずれが` +
    `しばしば論点となる。今回の材料についても、発表時点で既に相当程度が` +
    `価格に織り込まれていた可能性と、事後的に解釈が修正される可能性の双方があり、` +
    `現時点でどちらであったかを断定する材料は無い。\n\n` +
    `関連して、同じ材料が異なる資産クラスで異なる解釈をされている点も指摘できる。` +
    `株式市場では業績見通しへの含意として、金利市場では政策経路への含意として` +
    `読まれる傾向があり、両者の反応が整合しない場合には、` +
    `どちらかの市場が材料を過大または過小に評価している可能性がある。\n\n` +
    `加えて、公表データの集計基準にも注意が必要である。同種の統計でも` +
    `対象範囲や計上時点が異なる場合があり、前年比と前月比のどちらを見るかで` +
    `印象が変わることがある。特に季節調整の有無は、単月の振れを` +
    `トレンドの変化と誤読させる原因になりやすい。本件についても、` +
    `単月の動きをもって基調の転換と判断するのは早計であるとみられる。\n\n` +
    `市場参加者の反応という観点では、材料が伝わった時間帯も無視できない。` +
    `流動性の薄い時間帯に伝わった材料は、同じ内容でも値幅が拡大しやすく、` +
    `その後の時間帯で値を戻す場合がある。したがって初期反応の大きさを` +
    `材料の重要度の代理指標として用いることには限界がある。\n\n` +
    `詳細は原文を参照されたい: ${url}\n`;

  return JSON.stringify({
    theme,
    title: `[MOCK] ${theme}をめぐる論点整理`,
    summary,
    detail_md: detail,
    analysis_md: buildAnalysis(theme, 2000),
    sources: [{ name: 'モック情報源', url }],
  });
}

export function mockRecap(): string {
  const body =
    `## 前日の米国市場概況(モック)\n\n` +
    `本モックでは実データを取得していないため、主要指数(S&P500・NASDAQ・ダウ・SOX)の` +
    `騰落率はいずれも未確認である。同様に、米金利の2年・10年・30年の各年限、` +
    `ドル円、原油、金の水準についても未確認として扱う。` +
    `捏造した数値を置かない方針であるため、本節では数値の代わりに` +
    `読み方の枠組みを示す。\n\n` +
    `指数の騰落を評価する際は、指数レベルの変化よりも、` +
    `寄与度の内訳を確認することが有用である。時価総額上位の少数銘柄が` +
    `指数全体を押し上げている局面と、値上がり銘柄数が広範に優勢な局面とでは、` +
    `同じ上昇率でも market breadth の含意が大きく異なる。` +
    `SOX指数は半導体サイクルへの感応度が高く、日本の関連銘柄への波及が` +
    `翌営業日の寄り付きに現れやすい。\n\n` +
    `米金利については、年限ごとの動きの差、すなわちカーブの形状変化を見る。` +
    `短期ゾーンの動きは政策金利の予想経路の修正を、` +
    `長期ゾーンの動きは期間プレミアムや需給の変化を反映する度合いが大きい。` +
    `両者が同方向に動いたのか、カーブがスティープ化またはフラット化したのかで、` +
    `ドル円および日本の金利市場への波及経路は変わる。\n\n` +
    `セクター動向と主要決算については、本モックでは個別の取得情報が無く未確認である。` +
    `当日の注目イベントも同様に未確認として扱う。\n\n` +
    `日本市場への波及経路としては、第一に米金利を通じた為替経由の影響、` +
    `第二に米半導体株を通じた関連銘柄への直接的な連動、` +
    `第三に米国市場のリスク許容度の変化が海外投資家の日本株フローに与える影響が挙げられる。` +
    `これらは同時に作用するため、寄り付きの水準だけでどの経路が支配的であったかを` +
    `判別することは難しいとみられる。\n\n` +
    `実務上は、寄り付き後の値持ちを確認することで経路の識別がある程度可能になる。` +
    `為替経由の影響が主因であれば輸出関連と内需関連の格差として現れやすく、` +
    `半導体経由であれば関連銘柄に集中した動きとなる。` +
    `リスク許容度の変化が主因の場合には、セクターを問わず広範に売買が偏り、` +
    `値上がり銘柄数と値下がり銘柄数の比率に明確な偏りが出る傾向がある。\n\n` +
    `また、米国市場の動きをそのまま日本市場に外挿する際には、` +
    `両市場の投資家構成の違いを踏まえる必要がある。` +
    `日本市場では海外投資家の売買比率が高く、その資金フローは` +
    `米国市場の動向だけでなく、為替ヘッジコストや他のアジア市場との` +
    `相対評価にも左右される。前日の米国市場が上昇していても` +
    `日本株が追随しない局面は、この経路の違いから生じることがある。\n`;

  return JSON.stringify({
    body_md: body,
    sources: [{ name: 'モック情報源', url: 'https://example.com/mock/us-recap' }],
  });
}

/** 英訳のモック。実際の翻訳品質のイメージが掴める程度の英文にする。 */
export function mockArticleEn(theme: string): string {
  return JSON.stringify({
    title: `[MOCK] Framing the debate around ${theme}`,
    summary:
      `Reports emerged regarding ${theme}. Available information remains limited at this stage, ` +
      `and specific figures are unconfirmed. The key question is whether this reflects a ` +
      `transitory supply-demand distortion or a more durable shift in expectations. This note ` +
      `lays out the implications for each of our three reader profiles and flags the ` +
      `positioning-related angles that tend to get overlooked.`,
    detail_md:
      `This section summarizes the sourced reporting in our own words.\n\n` +
      `According to the [mock source](https://example.com/mock), market attention is ` +
      `increasingly concentrated on a specific set of issues. As this mock provides no ` +
      `hard numbers, levels and percentage moves are treated as unconfirmed.\n\n` +
      `Note also that the same headline is being read differently across asset classes: ` +
      `equities frame it as an earnings story, while the rates market reads it through ` +
      `the policy-path lens. When the two markets disagree, one of them is mispricing ` +
      `the news.\n\n` +
      `Full details at the original source.\n`,
    analysis_md:
      `## Implications for the three reader profiles\n\n` +
      `For the hedge fund analyst, the question is less about the headline itself than ` +
      `whether the basis for relative valuation within the sector has shifted. Around ` +
      `earnings season, funding-structure differences cause the impact to disperse even ` +
      `within a single sector, so a blanket sector-level read risks missing the trade.\n\n` +
      `For the JGB trader, the issue is which part of the curve absorbs the move. The ` +
      `short end is governed by the expected policy path, while the super-long sector ` +
      `is driven by investor maturity preferences and supply-demand. The same headline ` +
      `can move the two in opposite directions. Cross-currency basis matters here too, ` +
      `as hedged foreign demand for JGBs runs through that channel.\n\n` +
      `For the equity strategist, the test is whether this can be placed within a broader ` +
      `shift in flows rather than treated as a one-off event. Foreign investor flows are ` +
      `only confirmed with a lag in the weekly data, so in the interim one has to infer ` +
      `them from futures-cash divergence and the shape of sector rotation.\n\n` +
      `## Extensions and forward-looking angles\n\n` +
      `What follows is inference, not established fact. First, whether this proves ` +
      `transitory or durable will only become clear with the next data release. Second, ` +
      `when positioning is crowded in one direction, price action can be amplified well ` +
      `beyond what the news itself warrants. Third, where regulatory change is involved, ` +
      `the gap between implementation timing and market pricing tends to create ` +
      `short-lived dislocations.\n\n` +
      `## Overlooked but worth tracking\n\n` +
      `Positioning indicators — futures open interest, the sign of dealer gamma, ` +
      `arbitrage balances — update on different frequencies, so aligning the time series ` +
      `matters when comparing them. These rarely make headlines but often become the ` +
      `dominant driver once crowded positions unwind.\n`,
  });
}

export function mockRecapEn(): string {
  return JSON.stringify({
    body_md:
      `## Previous US Session (mock)\n\n` +
      `As this mock retrieves no live data, index moves for the S&P 500, Nasdaq, Dow and ` +
      `SOX are unconfirmed, as are Treasury yields across the 2s, 10s and 30s, dollar-yen, ` +
      `crude and gold. Rather than fabricate figures, this section outlines the reading ` +
      `framework.\n\n` +
      `When assessing index moves, the contribution breakdown matters more than the ` +
      `headline level. A rally led by a handful of mega-caps and one with broad breadth ` +
      `carry very different implications even at the same percentage move. The SOX is ` +
      `highly sensitive to the semiconductor cycle, and its moves tend to feed through ` +
      `to related Japanese names at the next session's open.\n\n` +
      `On rates, watch the shape of the curve rather than any single tenor: front-end ` +
      `moves reflect repricing of the policy path, while the long end embeds term premium ` +
      `and supply-demand. Whether the curve bear-steepened or bull-flattened changes the ` +
      `transmission channel into dollar-yen and the JGB market.\n\n` +
      `For Japan, transmission runs through three channels: rates via FX, semiconductors ` +
      `via direct linkage, and risk appetite via foreign investor flows. These operate ` +
      `simultaneously, so the opening level alone rarely identifies which dominated.\n`,
  });
}
