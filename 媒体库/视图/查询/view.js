// Shared, read-only search rules for the full search and category pages.
if (!window.__mediaLibraryQuery || window.__mediaLibraryQuery.version !== 2) {
  const scrollBindings = new WeakMap();
  const toArray = value => {
    if (!value) return [];
    if (Array.isArray(value)) return value;
    if (typeof value.array === "function") return value.array();
    return [value];
  };
  const plainText = value => {
    if (value === null || value === undefined || value === "") return "";
    if (value.path) return value.path.split("/").pop();
    return String(value).replace(/^\[\[/, "").replace(/\]\]$/, "").split("|")[0];
  };
  const values = value => toArray(value).map(plainText).filter(Boolean);
  const normalize = value => plainText(value)
    .normalize("NFKC")
    .toLocaleLowerCase("zh-Hans-CN")
    .replace(/[，。；、·・:：_—–\-\/\\]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const linkPath = value => {
    if (!value) return "";
    const raw = value.path ?? String(value);
    return String(raw).replace(/^\[\[/, "").replace(/\]\]$/, "")
      .split("|")[0].replace(/\.md$/i, "");
  };
  const pointsTo = (value, target) => {
    const path = linkPath(value);
    if (!path || !target?.file) return false;
    return path === target.file.path.replace(/\.md$/i, "")
      || path === target.file.name
      || path.endsWith(`/${target.file.name}`);
  };
  const uniqueTexts = items => [...new Set(items.map(plainText).filter(Boolean))];
  const groupTitle = group => group?.title || group?.file?.name || "";
  const groupSearchTerms = group => uniqueTexts([
    groupTitle(group), group?.file?.name, ...values(group?.aliases)
  ]);
  const yearFor = page => {
    if (!page.release_date) return "未知年份";
    if (typeof page.release_date.toFormat === "function") return page.release_date.toFormat("yyyy");
    const match = String(page.release_date).match(/\d{4}/);
    return match ? match[0] : "未知年份";
  };
  const relationsFor = (page, seriesGroups, collectionGroups) => {
    const rawSeries = plainText(page.series);
    const seriesGroup = seriesGroups.find(group => pointsTo(page.series, group));
    const seriesNames = seriesGroup ? groupSearchTerms(seriesGroup) : uniqueTexts([rawSeries]);
    const seriesName = seriesGroup ? groupTitle(seriesGroup) : rawSeries;
    const directValues = toArray(page.collections);
    const directGroups = collectionGroups.filter(group => directValues.some(value => pointsTo(value, group)));
    const inheritedValues = toArray(seriesGroup?.collections);
    const inheritedGroups = collectionGroups.filter(group => inheritedValues.some(value => pointsTo(value, group)));
    const effectiveGroups = [...new Map(
      [...directGroups, ...inheritedGroups].map(group => [group.file.path, group])
    ).values()];
    const collectionNames = uniqueTexts([
      ...effectiveGroups.map(groupTitle),
      ...directValues.filter(value => !directGroups.some(group => pointsTo(value, group))).map(plainText),
      ...inheritedValues.filter(value => !inheritedGroups.some(group => pointsTo(value, group))).map(plainText)
    ]);
    const baseTerms = uniqueTexts([...collectionNames, ...effectiveGroups.flatMap(groupSearchTerms)]);
    return {
      seriesName,
      seriesTerms: uniqueTexts([...seriesNames, ...seriesNames.map(name => `${name}系列`)]),
      collectionNames,
      collectionTerms: uniqueTexts([...baseTerms, ...baseTerms.map(name => `${name}合集`)])
    };
  };
  const createIndex = (pages, groups, typeMeta = {}) => {
    const seriesGroups = groups.filter(group => group.collection_kind === "series");
    const collectionGroups = groups.filter(group => group.collection_kind === "collection");
    return pages.map(page => {
      const effectiveRelations = relationsFor(page, seriesGroups, collectionGroups);
      const titles = [page.title || page.file.name, page.original_title, page.file.name, ...values(page.aliases)]
        .map(plainText).filter(Boolean);
      const people = [
        ...values(page.authors), ...values(page.translators), ...values(page.directors),
        ...values(page.screenwriters), ...values(page.cast), plainText(page.publisher),
        plainText(page.developer)
      ].filter(Boolean);
      const relations = [
        ...effectiveRelations.seriesTerms, ...effectiveRelations.collectionTerms,
        ...values(page.related), plainText(page.source_series)
      ].filter(Boolean);
      const categories = [
        typeMeta[page.media_type]?.label, page.media_type, page.status,
        ...values(page.genres), ...values(page.platforms), plainText(page.format),
        ...values(page.country), ...values(page.language),
        effectiveRelations.seriesName ? "系列" : "",
        effectiveRelations.collectionNames.length ? "合集" : ""
      ].filter(Boolean);
      const identifiers = [page.release_date, yearFor(page), page.imdb_id, page.isbn, page.source_id]
        .map(plainText).filter(Boolean);
      const sections = {
        titles: titles.map(normalize),
        people: people.map(normalize),
        relations: relations.map(normalize),
        categories: categories.map(normalize),
        identifiers: identifiers.map(normalize)
      };
      return {
        page, titles, people, relations, categories, effectiveRelations,
        sections, haystack: Object.values(sections).flat().join(" ")
      };
    });
  };
  const matches = (entry, query) => {
    const terms = normalize(query).split(" ").filter(Boolean);
    return terms.every(term => entry.haystack.includes(term));
  };
  const readState = (key, defaults) => {
    try {
      const value = JSON.parse(window.localStorage.getItem(key) || "null");
      return value && typeof value === "object" && !Array.isArray(value)
        ? { ...defaults, ...value } : { ...defaults };
    } catch (error) {
      return { ...defaults };
    }
  };
  const saveState = (key, state) => {
    try {
      window.localStorage.setItem(key, JSON.stringify(state));
    } catch (error) {
      console.warn("无法保存媒体库筛选状态", error);
    }
  };
  const bindScroll = (container, state, persist) => {
    const host = container.closest(".markdown-preview-view, .cm-scroller");
    if (!host) return;
    const previous = scrollBindings.get(host);
    if (previous) host.removeEventListener("scroll", previous);
    const onScroll = () => {
      state.scrollTop = host.scrollTop;
      persist();
    };
    host.addEventListener("scroll", onScroll, { passive: true });
    scrollBindings.set(host, onScroll);
    window.setTimeout(() => {
      host.scrollTop = Math.max(0, Number(state.scrollTop) || 0);
    }, 80);
  };
  window.__mediaLibraryQuery = { version: 2, normalize, createIndex, matches, readState, saveState, bindScroll };
}
