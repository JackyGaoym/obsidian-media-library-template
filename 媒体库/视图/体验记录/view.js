const resultMeta = {
  completed: { label: "已完成", workStatus: "已完成" },
  abandoned: { label: "已弃置", workStatus: "弃置" }
};

const unitMeta = {
  page: "页",
  episode: "集",
  minute: "分钟",
  percent: "%"
};

const progressFields = {
  book: "progress_page",
  tv: "progress_episode",
  anime: "progress_episode",
  movie: "progress_minute",
  game: "progress_percent"
};

const linkTarget = value => {
  if (!value) return "";
  if (value.path) return String(value.path).replace(/\.md$/i, "");
  return String(value)
    .replace(/^\[\[/, "")
    .replace(/\]\]$/, "")
    .split("|")[0]
    .replace(/\.md$/i, "");
};

const dateText = value => {
  if (!value) return "";
  if (typeof value.toFormat === "function") return value.toFormat("yyyy-MM-dd");
  const match = String(value).match(/^\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : "";
};

const numberFrom = value => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};

const listFrom = value => {
  if (Array.isArray(value)) return [...value];
  if (value && typeof value.array === "function") return value.array();
  return value ? [value] : [];
};

const validDate = value => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(year, month - 1, day);
  return parsed.getFullYear() === year
    && parsed.getMonth() === month - 1
    && parsed.getDate() === day;
};

const validYear = value => {
  const year = Number(value);
  return Number.isInteger(year) && year >= 1800 && year <= new Date().getFullYear() + 1;
};

const showNotice = message => {
  try {
    const NoticeClass = typeof require === "function" ? require("obsidian").Notice : null;
    if (NoticeClass) new NoticeClass(message);
  } catch (error) {
    console.error(message, error);
  }
};

const ensureFolder = async folderPath => {
  let current = "";
  for (const part of folderPath.split("/").filter(Boolean)) {
    current = current ? `${current}/${part}` : part;
    if (!app.vault.getAbstractFileByPath(current)) {
      try {
        await app.vault.createFolder(current);
      } catch (error) {
        if (!app.vault.getAbstractFileByPath(current)) throw error;
      }
    }
  }
};

const cloneValue = value => Array.isArray(value) ? [...value] : value;

const restoreFields = (frontmatter, snapshot) => {
  for (const [key, item] of Object.entries(snapshot)) {
    if (item.exists) frontmatter[key] = cloneValue(item.value);
    else delete frontmatter[key];
  }
};

const currentPage = dv.current();
const workPath = linkTarget(currentPage.work);
const workPage = workPath ? dv.page(workPath) : null;
let currentPath = currentPage.file.path;

const record = {
  result: resultMeta[currentPage.result] ? String(currentPage.result) : "completed",
  origin: String(currentPage.record_origin || "migrated"),
  certainty: String(currentPage.date_certainty || "unknown"),
  yearVerified: currentPage.year_verified === true,
  verifiedYear: Math.round(numberFrom(currentPage.verified_year)) || 0,
  startedAt: dateText(currentPage.started_at),
  endedAt: dateText(currentPage.ended_at),
  progressValue: numberFrom(currentPage.progress_value),
  progressTotal: numberFrom(currentPage.progress_total),
  progressUnit: unitMeta[currentPage.progress_unit] ? String(currentPage.progress_unit) : "percent",
  rating: numberFrom(currentPage.experience_rating),
  edition: currentPage.edition ? String(currentPage.edition) : "",
  playedOn: listFrom(currentPage.played_on).map(String).filter(Boolean),
  createdAt: dateText(currentPage.created_at),
  experienceIndex: Math.max(1, Math.round(numberFrom(currentPage.experience_index)) || 1)
};

const work = {
  filePath: workPage?.file?.path || (workPath ? `${workPath}.md` : ""),
  mediaType: String(workPage?.media_type || ""),
  status: String(workPage?.status || ""),
  experienceIndex: Math.max(1, Math.round(numberFrom(workPage?.experience_index)) || 1)
};

const verificationMode = () => !record.yearVerified
  ? "pending"
  : record.certainty === "exact" ? "exact" : "year";

const verificationLabel = () => {
  if (!record.yearVerified) return "日期待确认";
  return record.certainty === "exact" ? "精确日期" : "仅年份确认";
};

const isCrossYear = () => record.certainty === "exact"
  && /^\d{4}/.test(record.startedAt)
  && /^\d{4}/.test(record.endedAt)
  && record.startedAt.slice(0, 4) !== record.endedAt.slice(0, 4);

const dateLabel = () => {
  const range = [record.startedAt, record.endedAt].filter(Boolean).join(" — ");
  if (!record.yearVerified) return range ? `${range}（待确认）` : "日期未知（待确认）";
  if (record.certainty === "exact") return range || `${record.verifiedYear} 年`;
  return range
    ? `${record.verifiedYear} 年（原记录 ${range}，具体日期约）`
    : `${record.verifiedYear} 年（具体日期未知）`;
};

const progressLabel = () => {
  const unit = unitMeta[record.progressUnit] || record.progressUnit;
  if (record.progressTotal > 0) return `${record.progressValue} / ${record.progressTotal} ${unit}`;
  if (record.progressValue > 0) return `${record.progressValue} ${unit}`;
  return "未记录";
};

const shouldSyncCurrentWork = () => work.experienceIndex === record.experienceIndex
  && work.status === resultMeta[record.result].workStatus;

const root = dv.container.createDiv({ cls: "media-experience-detail" });
let editing = false;
let saving = false;

const render = () => {
  root.empty();
  root.toggleClass("is-saving", saving);

  const header = root.createDiv({ cls: "media-experience-detail-header" });
  const badges = header.createDiv({ cls: "media-experience-detail-badges" });
  badges.createSpan({ cls: `media-experience-detail-badge is-${record.result}`, text: resultMeta[record.result].label });
  badges.createSpan({
    cls: `media-experience-detail-badge is-${verificationMode()}`,
    text: verificationLabel()
  });
  badges.createSpan({
    cls: "media-experience-detail-badge is-origin",
    text: record.origin === "tracked" ? "正常记录" : "历史补录"
  });
  if (isCrossYear()) {
    badges.createSpan({
      cls: "media-experience-detail-badge is-cross-year",
      text: record.result === "abandoned" ? "跨年弃置" : "跨年完成"
    });
  }

  const editButton = header.createEl("button", {
    cls: "media-experience-detail-edit",
    text: editing ? "收起编辑" : "编辑记录",
    attr: { type: "button" }
  });
  editButton.disabled = saving;
  editButton.addEventListener("click", () => {
    editing = !editing;
    render();
  });

  const summary = root.createDiv({ cls: "media-experience-detail-summary" });
  const addSummary = (label, value, cls = "") => {
    const item = summary.createDiv({ cls: `media-experience-detail-summary-item ${cls}`.trim() });
    item.createSpan({ text: label });
    item.createEl("strong", { text: value });
  };
  addSummary("日期", dateLabel(), "is-wide");
  addSummary("本次评分", record.rating > 0 ? `★ ${record.rating}` : "未评分");
  addSummary("结束进度", progressLabel());
  if (record.edition) addSummary("版本", record.edition);
  if (record.playedOn.length) addSummary("游玩平台", record.playedOn.join(" / "));
  if (record.createdAt) addSummary("记录生成", record.createdAt);

  const note = root.createDiv({ cls: `media-experience-detail-note is-${verificationMode()}` });
  if (verificationMode() === "pending") {
    note.setText("这条记录尚未确认，不会进入正式年度回顾。点击“编辑记录”，选择精确日期或只确认年份即可完成确认。");
  } else if (verificationMode() === "year") {
    note.setText("这条记录只确认了所属年份，会计入年度总数，但不会进入月份时间线。");
  } else if (shouldSyncCurrentWork()) {
    note.setText("这是作品当前这一次体验；保存后会同步作品页的状态、评分和进度，精确日期也会一并同步。");
  } else {
    note.setText("这是一条已结束的历史快照；修改它不会覆盖作品当前正在使用的数据。");
  }

  if (!editing) return;

  const editor = root.createDiv({ cls: "media-experience-detail-editor" });
  const field = (label, control) => {
    const wrapper = editor.createEl("label", { cls: "media-experience-detail-field" });
    wrapper.createSpan({ text: label });
    wrapper.appendChild(control);
    return control;
  };

  const resultSelect = document.createElement("select");
  for (const [value, meta] of Object.entries(resultMeta)) {
    resultSelect.createEl("option", { text: meta.label, attr: { value } });
  }
  resultSelect.value = record.result;
  field("结果", resultSelect);

  const modeSelect = document.createElement("select");
  for (const [value, label] of [["exact", "精确日期"], ["year", "只确认年份"], ["pending", "保持待确认"]]) {
    modeSelect.createEl("option", { text: label, attr: { value } });
  }
  modeSelect.value = verificationMode();
  field("日期可信度", modeSelect);

  const startInput = document.createElement("input");
  startInput.type = "date";
  startInput.value = record.startedAt;
  field("开始日期（可留空）", startInput);

  const endInput = document.createElement("input");
  endInput.type = "date";
  endInput.value = record.endedAt;
  field("结束日期", endInput);

  const yearInput = document.createElement("input");
  yearInput.type = "number";
  yearInput.min = "1800";
  yearInput.max = String(new Date().getFullYear() + 1);
  yearInput.value = String(record.verifiedYear || Number(record.endedAt.slice(0, 4)) || new Date().getFullYear());
  field("确认年份", yearInput);

  const ratingSelect = document.createElement("select");
  ratingSelect.createEl("option", { text: "未评分", attr: { value: "" } });
  for (let rating = 0.5; rating <= 5; rating += 0.5) {
    ratingSelect.createEl("option", { text: `${rating} 星`, attr: { value: String(rating) } });
  }
  ratingSelect.value = record.rating > 0 ? String(record.rating) : "";
  field("本次评分", ratingSelect);

  const progressValueInput = document.createElement("input");
  progressValueInput.type = "number";
  progressValueInput.min = "0";
  progressValueInput.step = "1";
  progressValueInput.value = String(record.progressValue || 0);
  field("结束进度", progressValueInput);

  const progressTotalInput = document.createElement("input");
  progressTotalInput.type = "number";
  progressTotalInput.min = "0";
  progressTotalInput.step = "1";
  progressTotalInput.value = record.progressTotal > 0 ? String(record.progressTotal) : "";
  field("总进度（可留空）", progressTotalInput);

  const unitSelect = document.createElement("select");
  for (const [value, label] of Object.entries(unitMeta)) {
    unitSelect.createEl("option", { text: label, attr: { value } });
  }
  unitSelect.value = record.progressUnit;
  field("进度单位", unitSelect);

  const editionInput = document.createElement("input");
  editionInput.type = "text";
  editionInput.value = record.edition;
  editionInput.placeholder = "例如：导演剪辑版";
  field("本次版本（可留空）", editionInput);

  let playedOnInput = null;
  if (work.mediaType === "game" || record.playedOn.length) {
    playedOnInput = document.createElement("input");
    playedOnInput.type = "text";
    playedOnInput.value = record.playedOn.join("、");
    playedOnInput.placeholder = "多个平台用顿号或逗号分隔";
    field("本次游玩平台", playedOnInput);
  }

  const help = root.createDiv({ cls: "media-experience-detail-help" });
  const updateMode = () => {
    yearInput.disabled = modeSelect.value !== "year";
    help.setText(modeSelect.value === "exact"
      ? "精确日期要求填写结束日期；若这是当前体验，还会同步作品页的共用数据。"
      : modeSelect.value === "year"
        ? "只确认年份时，具体日期不会反推作品页；当前体验的状态、评分和进度仍会同步。"
        : "保持待确认时，这条记录不会进入正式年度回顾。");
  };
  modeSelect.addEventListener("change", updateMode);
  updateMode();

  const actions = root.createDiv({ cls: "media-experience-detail-actions" });
  const cancelButton = actions.createEl("button", { cls: "is-secondary", text: "取消", attr: { type: "button" } });
  const saveButton = actions.createEl("button", { text: "保存修改", attr: { type: "button" } });
  cancelButton.disabled = saving;
  saveButton.disabled = saving;

  cancelButton.addEventListener("click", () => {
    editing = false;
    render();
  });

  saveButton.addEventListener("click", async () => {
    if (saving) return;
    const mode = modeSelect.value;
    const startedAt = startInput.value;
    const endedAt = endInput.value;
    const confirmedYear = Number(yearInput.value);
    const progressValue = Number(progressValueInput.value || 0);
    const progressTotal = progressTotalInput.value === "" ? 0 : Number(progressTotalInput.value);

    if (startedAt && !validDate(startedAt)) {
      showNotice("开始日期格式不正确，可以清空后再保存");
      return;
    }
    if (endedAt && !validDate(endedAt)) {
      showNotice("结束日期格式不正确");
      return;
    }
    if (startedAt && endedAt && startedAt > endedAt) {
      showNotice("开始日期不能晚于结束日期");
      return;
    }
    if (mode === "exact" && !validDate(endedAt)) {
      showNotice("确认精确日期需要填写有效的结束日期");
      return;
    }
    if (mode === "year" && !validYear(confirmedYear)) {
      showNotice("请填写有效的确认年份");
      return;
    }
    if (!Number.isFinite(progressValue) || progressValue < 0 || !Number.isFinite(progressTotal) || progressTotal < 0) {
      showNotice("进度不能是负数");
      return;
    }
    if (progressTotal > 0 && progressValue > progressTotal) {
      showNotice("结束进度不能大于总进度");
      return;
    }

    const nextYear = mode === "exact" ? Number(endedAt.slice(0, 4)) : mode === "year" ? confirmedYear : 0;
    const updates = {
      result: resultSelect.value,
      started_at: startedAt || null,
      ended_at: endedAt || null,
      date_certainty: mode === "exact" ? "exact" : (endedAt ? "approximate" : "unknown"),
      year_verified: mode !== "pending",
      verified_year: mode === "exact" ? nextYear : mode === "year" ? confirmedYear : null,
      progress_value: progressValue,
      progress_total: progressTotal > 0 ? progressTotal : null,
      progress_unit: unitSelect.value,
      experience_rating: ratingSelect.value ? Number(ratingSelect.value) : null,
      edition: editionInput.value.trim() || null,
      played_on: playedOnInput
        ? [...new Set(playedOnInput.value.split(/[、,，]/).map(item => item.trim()).filter(Boolean))]
        : record.playedOn
    };

    const currentFile = app.vault.getAbstractFileByPath(currentPath);
    if (!currentFile) {
      showNotice("找不到当前记录文件");
      return;
    }

    const destinationFolder = nextYear ? `媒体库/记录/${nextYear}` : "";
    const destinationPath = destinationFolder ? `${destinationFolder}/${currentFile.name}` : currentPath;
    if (destinationPath !== currentPath && app.vault.getAbstractFileByPath(destinationPath)) {
      showNotice(`目标年份已有同名记录：${destinationPath}`);
      return;
    }

    const syncWork = shouldSyncCurrentWork();
    const workFile = syncWork && work.filePath ? app.vault.getAbstractFileByPath(work.filePath) : null;
    if (syncWork && !workFile) {
      showNotice("找不到对应作品文件，未保存修改");
      return;
    }

    const historySnapshot = {};
    const workSnapshot = {};
    const workUpdates = syncWork ? {
      status: resultMeta[updates.result].workStatus,
      rating: updates.experience_rating
    } : null;
    if (workUpdates && mode === "exact") {
      workUpdates.started_at = updates.started_at;
      workUpdates.finished_at = updates.result === "completed" ? updates.ended_at : null;
      workUpdates.last_activity_at = updates.ended_at;
    }
    const progressField = progressFields[work.mediaType];
    if (workUpdates && progressField) workUpdates[progressField] = updates.progress_value;

    saving = true;
    render();
    let recordSaved = false;
    let workSaved = false;
    try {
      if (destinationFolder) await ensureFolder(destinationFolder);
      await app.fileManager.processFrontMatter(currentFile, frontmatter => {
        for (const [key, value] of Object.entries(updates)) {
          historySnapshot[key] = {
            exists: Object.prototype.hasOwnProperty.call(frontmatter, key),
            value: cloneValue(frontmatter[key])
          };
          frontmatter[key] = cloneValue(value);
        }
      });
      recordSaved = true;

      if (workUpdates) {
        await app.fileManager.processFrontMatter(workFile, frontmatter => {
          for (const [key, value] of Object.entries(workUpdates)) {
            workSnapshot[key] = {
              exists: Object.prototype.hasOwnProperty.call(frontmatter, key),
              value: cloneValue(frontmatter[key])
            };
            frontmatter[key] = cloneValue(value);
          }
        });
        workSaved = true;
      }

      if (destinationPath !== currentPath) {
        await app.fileManager.renameFile(currentFile, destinationPath);
        currentPath = destinationPath;
      }

      record.result = updates.result;
      record.startedAt = startedAt;
      record.endedAt = endedAt;
      record.certainty = updates.date_certainty;
      record.yearVerified = updates.year_verified;
      record.verifiedYear = Number(updates.verified_year) || 0;
      record.progressValue = progressValue;
      record.progressTotal = progressTotal;
      record.progressUnit = updates.progress_unit;
      record.rating = Number(updates.experience_rating) || 0;
      record.edition = updates.edition || "";
      record.playedOn = [...updates.played_on];
      work.status = workUpdates?.status || work.status;
      editing = false;
      showNotice(syncWork ? "记录与作品当前数据已同步" : "记录已保存");
    } catch (error) {
      console.error("保存体验记录失败", error);
      if (workSaved && workFile) {
        try {
          await app.fileManager.processFrontMatter(workFile, frontmatter => restoreFields(frontmatter, workSnapshot));
        } catch (rollbackError) {
          console.error("作品数据回滚失败", rollbackError);
        }
      }
      if (recordSaved) {
        try {
          await app.fileManager.processFrontMatter(currentFile, frontmatter => restoreFields(frontmatter, historySnapshot));
        } catch (rollbackError) {
          console.error("记录数据回滚失败", rollbackError);
        }
      }
      showNotice(`保存失败：${error.message || error}`);
    } finally {
      saving = false;
      render();
      window.setTimeout(() => app.workspace.trigger("dataview:refresh-views"), 120);
    }
  });
};

render();
