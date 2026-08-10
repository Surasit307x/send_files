import fontkit from '@pdf-lib/fontkit/dist/fontkit.umd.js';
import { Asset } from 'expo-asset';
import { downloadPdf } from '../downloadPdf';
import {
  PDFDocument,
  clip,
  closePath,
  endPath,
  lineTo,
  moveTo,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from 'pdf-lib/dist/pdf-lib.esm.js';

import {
  isWorkDetailStatusCompleted,
  resolveWorkDetailStatusRgb,
  type WorkDetailRow,
  type WorkDetailStatus,
} from '../work-detail-document';
import {
  WORK_CORRECTION_FULL_OPEN_FILL_MOCK_MODEL,
  formatThaiBuddhistDate,
  getWorkCorrectionFullPdfFileName,
  type WorkCorrectionFullImageRef,
  type WorkCorrectionFullModel,
} from './workCorrectionFullModel';
import { authorizedFetch } from '../../../services/api/auth-fetch';
import { getDefectSignedOpen } from '../../../services/api/modules/order/order.service';

const PT_PER_MM = 2.83465;
const mm = (value: number) => value * PT_PER_MM;

const PAGE_WIDTH = mm(210);
const PAGE_HEIGHT = mm(297);
const PAGE_MARGIN_X = mm(8);
const PAGE_MARGIN_Y = mm(8);
const CONTENT_WIDTH = PAGE_WIDTH - PAGE_MARGIN_X * 2;

const BODY_FONT_SIZE = 8;
const SMALL_FONT_SIZE = 8;
const HEADER_FONT_SIZE = 12;
const TITLE_FONT_SIZE = 12;
const LINE_HEIGHT = mm(4);

const BORDER_COLOR = rgb(0.62, 0.66, 0.7);
const TEXT_COLOR = rgb(0.12, 0.14, 0.18);
const MUTED_COLOR = rgb(0.42, 0.45, 0.5);
const HEAD_FILL = rgb(0.6, 0.78, 0.88);
const PIN_FILL = rgb(0.78, 0.1, 0.1);
const WHITE = rgb(1, 1, 1);

function statusColor(status: WorkDetailStatus) {
  const [r, g, b] = resolveWorkDetailStatusRgb(status);
  return rgb(r, g, b);
}

const TITLE_BAR_TOP = PAGE_MARGIN_Y;
const INFO_BOX_TOP = PAGE_MARGIN_Y + mm(22);
const INFO_BOX_HEIGHT = mm(38);
const PLAN_WIDTH = mm(92);
const TABLE_HEADER_HEIGHT = mm(9);
const ROW_HEIGHT = mm(28);
const COMPACT_HEADER_HEIGHT = mm(14);

const COL_NO = mm(12);
const COL_BEFORE = mm(44);
const COL_AFTER = mm(44);
const COL_ITEM = CONTENT_WIDTH - COL_NO - COL_BEFORE - COL_AFTER;

const ITEM_THUMB_W = mm(22);
const ITEM_TEXT_GAP = mm(3);

const PIN_ICON_SVG_PATH =
  'M5.625 0C2.52375 0 0 2.54125 0 5.66562C0 10.105 5.09625 14.6887 5.31313 14.8812C5.4025 14.9606 5.51375 15 5.625 15C5.73625 15 5.8475 14.9606 5.93687 14.8819C6.15375 14.6888 11.25 10.105 11.25 5.66562C11.25 2.54125 8.72625 0 5.625 0ZM5.625 8.75C3.90188 8.75 2.5 7.34812 2.5 5.625C2.5 3.90188 3.90188 2.5 5.625 2.5C7.34812 2.5 8.75 3.90188 8.75 5.625C8.75 7.34812 7.34812 8.75 5.625 8.75Z';
const PIN_ICON_WIDTH = 11.25;
const PIN_ICON_HEIGHT = 15;

type RasterImage = { image: PDFImage; width: number; height: number };

let cachedLightFont: Promise<Uint8Array> | null = null;
let cachedBoldFont: Promise<Uint8Array> | null = null;
let cachedLogo: Promise<Uint8Array> | null = null;

async function loadBytes(moduleRef: number) {
  const asset = Asset.fromModule(moduleRef);
  if (!asset.localUri) {
    await asset.downloadAsync();
  }
  const response = await authorizedFetch(asset.localUri ?? asset.uri);
  const buffer = await response.arrayBuffer();
  return new Uint8Array(buffer);
}

function loadLightFont() {
  if (!cachedLightFont) {
    cachedLightFont = loadBytes(require('../../../../assets/fonts/Anuphan-Light.ttf'));
  }
  return cachedLightFont;
}

function loadBoldFont() {
  if (!cachedBoldFont) {
    cachedBoldFont = loadBytes(require('../../../../assets/fonts/Anuphan-Bold.ttf'));
  }
  return cachedBoldFont;
}

function loadLogo() {
  if (!cachedLogo) {
    cachedLogo = loadBytes(require('../../../../assets/images/logo/LH_Logo.png'));
  }
  return cachedLogo;
}

function isPng(bytes: Uint8Array) {
  return (
    bytes.length > 4 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  );
}

function createImageEmbedder(pdfDoc: PDFDocument) {
  const cache = new Map<string, Promise<RasterImage | null>>();

  return async (ref: WorkCorrectionFullImageRef): Promise<RasterImage | null> => {
    if (ref == null) {
      return null;
    }

    const key = String(ref);
    if (!cache.has(key)) {
      cache.set(
        key,
        (async () => {
          try {
            const bytes =
              typeof ref === 'number'
                ? await loadBytes(ref)
                : new Uint8Array(await (await authorizedFetch(ref)).arrayBuffer());
            const image = isPng(bytes)
              ? await pdfDoc.embedPng(bytes)
              : await pdfDoc.embedJpg(bytes);
            return { image, width: image.width, height: image.height };
          } catch (error) {
            console.warn('work-correction-full embed image failed:', error);
            return null;
          }
        })(),
      );
    }

    return await cache.get(key)!;
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function drawRectTop(
  page: PDFPage,
  x: number,
  yTop: number,
  width: number,
  height: number,
  fill?: ReturnType<typeof rgb>,
) {
  page.drawRectangle({
    x,
    y: PAGE_HEIGHT - yTop - height,
    width,
    height,
    color: fill,
    borderColor: BORDER_COLOR,
    borderWidth: 0.7,
  });
}

function drawLineTop(page: PDFPage, x1: number, y1: number, x2: number, y2: number) {
  page.drawLine({
    start: { x: x1, y: PAGE_HEIGHT - y1 },
    end: { x: x2, y: PAGE_HEIGHT - y2 },
    color: BORDER_COLOR,
    thickness: 0.7,
  });
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number) {
  if (!text) return [''];
  const lines: string[] = [];

  for (const paragraph of text.split('\n')) {
    const indent = paragraph.match(/^\s+/)?.[0] ?? '';
    const words = paragraph.slice(indent.length).split(/ +/).filter(Boolean);
    let line = indent;
    let hasWord = false;

    for (const word of words) {
      const candidate = hasWord ? `${line} ${word}` : `${line}${word}`;
      if (hasWord && font.widthOfTextAtSize(candidate, size) > maxWidth) {
        lines.push(line);
        line = word;
      } else {
        line = candidate;
      }
      hasWord = true;

      while (font.widthOfTextAtSize(line, size) > maxWidth && line.length > 1) {
        let cut = line.length - 1;
        while (cut > 1 && font.widthOfTextAtSize(line.slice(0, cut), size) > maxWidth) {
          cut -= 1;
        }
        lines.push(line.slice(0, cut));
        line = line.slice(cut);
      }
    }

    lines.push(line);
  }

  return lines.length > 0 ? lines : [''];
}

function drawText(
  page: PDFPage,
  text: string,
  x: number,
  yTop: number,
  font: PDFFont,
  size: number,
  options: {
    maxWidth?: number;
    align?: 'left' | 'center';
    color?: ReturnType<typeof rgb>;
    lineHeight?: number;
  } = {},
) {
  const maxWidth = options.maxWidth ?? CONTENT_WIDTH;
  const lineHeight = options.lineHeight ?? LINE_HEIGHT;
  const lines = wrapText(text, font, size, maxWidth);
  lines.forEach((line, index) => {
    const textWidth = font.widthOfTextAtSize(line, size);
    const drawX = options.align === 'center' ? x + (maxWidth - textWidth) / 2 : x;
    page.drawText(line, {
      x: drawX,
      y: PAGE_HEIGHT - yTop - size - index * lineHeight,
      font,
      size,
      color: options.color ?? TEXT_COLOR,
    });
  });
  return lines.length * lineHeight;
}

function drawLabelValue(
  page: PDFPage,
  label: string,
  value: string,
  x: number,
  yTop: number,
  maxWidth: number,
  boldFont: PDFFont,
  regularFont: PDFFont,
  valueColor?: ReturnType<typeof rgb>,
) {
  const labelWidth = boldFont.widthOfTextAtSize(label, BODY_FONT_SIZE);
  page.drawText(label, {
    x,
    y: PAGE_HEIGHT - yTop - BODY_FONT_SIZE,
    font: boldFont,
    size: BODY_FONT_SIZE,
    color: TEXT_COLOR,
  });
  return drawText(page, value, x + labelWidth + mm(1), yTop, regularFont, BODY_FONT_SIZE, {
    maxWidth: maxWidth - labelWidth - mm(1),
    color: valueColor,
  });
}

function fitContain(cw: number, ch: number, sw: number, sh: number) {
  const ratio = Math.min(cw / sw, ch / sh);
  const width = sw * ratio;
  const height = sh * ratio;
  return { x: (cw - width) / 2, y: (ch - height) / 2, width, height };
}

function drawContainedImage(
  page: PDFPage,
  img: RasterImage,
  x: number,
  yTop: number,
  width: number,
  height: number,
  padding = 0,
) {
  const sw = Math.max(0, width - padding * 2);
  const sh = Math.max(0, height - padding * 2);
  const frame = fitContain(sw, sh, img.width, img.height);
  page.drawImage(img.image, {
    x: x + padding + frame.x,
    y: PAGE_HEIGHT - yTop - padding - frame.y - frame.height,
    width: frame.width,
    height: frame.height,
  });
  return {
    x: x + padding + frame.x,
    yTop: yTop + padding + frame.y,
    width: frame.width,
    height: frame.height,
  };
}

function drawZoomedPlan(
  page: PDFPage,
  img: RasterImage,
  x: number,
  yTop: number,
  width: number,
  height: number,
  point: { x: number; y: number },
  label: string,
  font: PDFFont,
  padding = 0,
) {
  const cellX = x + padding;
  const cellYTop = yTop + padding;
  const cellW = Math.max(0, width - padding * 2);
  const cellH = Math.max(0, height - padding * 2);
  if (cellW <= 0 || cellH <= 0) {
    return;
  }

  const cellAspect = cellW / cellH;
  let halfY = 0.21;
  let halfX = (halfY * cellAspect * img.height) / img.width;
  if (halfX > 0.5) {
    halfX = 0.5;
    halfY = (halfX * img.width) / (cellAspect * img.height);
  }
  if (halfY > 0.5) {
    halfY = 0.5;
    halfX = (halfY * cellAspect * img.height) / img.width;
  }

  const cx = clamp(point.x, halfX, 1 - halfX);
  const cy = clamp(point.y, halfY, 1 - halfY);
  const winX0 = cx - halfX;
  const winY0 = cy - halfY;
  const scale = cellW / (2 * halfX * img.width);
  const drawW = img.width * scale;
  const drawH = img.height * scale;
  const drawX = cellX - winX0 * img.width * scale;
  const drawYTop = cellYTop - winY0 * img.height * scale;
  const clipYBottom = PAGE_HEIGHT - cellYTop - cellH;

  page.pushOperators(
    pushGraphicsState(),
    moveTo(cellX, clipYBottom),
    lineTo(cellX, clipYBottom + cellH),
    lineTo(cellX + cellW, clipYBottom + cellH),
    lineTo(cellX + cellW, clipYBottom),
    closePath(),
    clip(),
    endPath(),
  );
  page.drawImage(img.image, {
    x: drawX,
    y: PAGE_HEIGHT - drawYTop - drawH,
    width: drawW,
    height: drawH,
  });
  page.pushOperators(popGraphicsState());

  const pinXn = (point.x - winX0) / (2 * halfX);
  const pinYn = (point.y - winY0) / (2 * halfY);
  drawPin(
    page,
    { x: pinXn, y: pinYn },
    label,
    { x: cellX, yTop: cellYTop, width: cellW, height: cellH },
    font,
  );
}

function drawPin(
  page: PDFPage,
  point: { x: number; y: number },
  label: string,
  frame: { x: number; yTop: number; width: number; height: number },
  font: PDFFont,
) {
  const anchorX = frame.x + clamp(point.x, 0, 1) * frame.width;
  const anchorYTop = frame.yTop + clamp(point.y, 0, 1) * frame.height;
  const pinHeight = clamp(frame.height * 0.13, mm(5.4), mm(8));
  const pinScale = pinHeight / PIN_ICON_HEIGHT;
  const pinWidth = PIN_ICON_WIDTH * pinScale;
  const pinTop = anchorYTop - pinHeight;
  const pinX = anchorX - 5.625 * pinScale;

  page.drawSvgPath(PIN_ICON_SVG_PATH, {
    x: pinX,
    y: PAGE_HEIGHT - pinTop,
    scale: pinScale,
    color: PIN_FILL,
    borderColor: WHITE,
    borderWidth: 0.6,
  });

  const badgeRadius = clamp(pinHeight * 0.26, mm(2), mm(3));
  const badgeX = pinX + pinWidth - badgeRadius * 0.2;
  const badgeYTop = pinTop + badgeRadius * 1.2;

  page.drawCircle({
    x: badgeX,
    y: PAGE_HEIGHT - badgeYTop,
    size: badgeRadius,
    color: PIN_FILL,
    borderColor: WHITE,
    borderWidth: 0.9,
  });

  const fontSize = BODY_FONT_SIZE;
  const labelWidth = font.widthOfTextAtSize(label, fontSize);
  page.drawText(label, {
    x: badgeX - labelWidth / 2,
    y: PAGE_HEIGHT - badgeYTop - fontSize * 0.42,
    font,
    size: fontSize,
    color: WHITE,
  });
}

function toInspectLabel(prefix: string): string {
  if (prefix.startsWith('ตรวจเปิดรายการ')) return 'วันที่ตรวจเปิดรายการ';
  const match = prefix.match(/ครั้งที่\s*(\d+)/);
  return match ? `วันที่ตรวจรับรายการ ใบงานที่ ${match[1]}` : `วันที่${prefix}`;
}

function drawDocumentHeader(
  page: PDFPage,
  model: WorkCorrectionFullModel,
  logo: PDFImage,
  boldFont: PDFFont,
  pageIndex: number,
  totalPages: number,
) {
  const logoHeight = mm(9);
  const logoWidth = (logo.width / logo.height) * logoHeight;
  page.drawImage(logo, {
    x: PAGE_MARGIN_X,
    y: PAGE_HEIGHT - TITLE_BAR_TOP - logoHeight,
    width: logoWidth,
    height: logoHeight,
  });

  const headerDateDisplay = formatThaiBuddhistDate(model.headerDateValue);
  const dateWidth = boldFont.widthOfTextAtSize(headerDateDisplay, HEADER_FONT_SIZE);
  page.drawText(headerDateDisplay, {
    x: PAGE_WIDTH - PAGE_MARGIN_X - dateWidth,
    y: PAGE_HEIGHT - TITLE_BAR_TOP - HEADER_FONT_SIZE,
    font: boldFont,
    size: HEADER_FONT_SIZE,
    color: TEXT_COLOR,
  });

  const pageLabel = `${model.headerLabel}   หน้า ${pageIndex} / ${totalPages}`;
  const pageLabelWidth = boldFont.widthOfTextAtSize(pageLabel, BODY_FONT_SIZE);
  page.drawText(pageLabel, {
    x: PAGE_WIDTH - PAGE_MARGIN_X - pageLabelWidth,
    y: PAGE_HEIGHT - TITLE_BAR_TOP - HEADER_FONT_SIZE - mm(5),
    font: boldFont,
    size: BODY_FONT_SIZE,
    color: MUTED_COLOR,
  });
}

function drawInfoBox(
  page: PDFPage,
  model: WorkCorrectionFullModel,
  planImage: RasterImage | null,
  boldFont: PDFFont,
  regularFont: PDFFont,
) {
  const titleWidth = boldFont.widthOfTextAtSize(model.documentTitle, TITLE_FONT_SIZE);
  page.drawText(model.documentTitle, {
    x: (PAGE_WIDTH - titleWidth) / 2,
    y: PAGE_HEIGHT - (PAGE_MARGIN_Y + mm(11)) - TITLE_FONT_SIZE,
    font: boldFont,
    size: TITLE_FONT_SIZE,
    color: TEXT_COLOR,
  });

  const planX = PAGE_MARGIN_X;
  const dividerX = planX + PLAN_WIDTH;
  const infoX = dividerX + mm(3);
  const infoW = CONTENT_WIDTH - PLAN_WIDTH - mm(6);

  let y = INFO_BOX_TOP + mm(3);
  const minStep = mm(4.6);
  const rowGap = mm(0.6);
  const adv = (h: number) => { y += Math.max(minStep, h + rowGap); };

  adv(drawLabelValue(page, 'โครงการ: ', model.projectName, infoX, y, infoW, boldFont, regularFont));
  adv(drawLabelValue(page, 'ประเภทงาน: ', model.workTypeLabel, infoX, y, infoW, boldFont, regularFont));
  adv(drawLabelValue(page, 'เลขเอกสาร: ', model.documentNo, infoX, y, infoW, boldFont, regularFont));
  adv(drawLabelValue(
    page,
    `${toInspectLabel(model.headerLabel)}: `,
    formatThaiBuddhistDate(model.openInspectDateValue),
    infoX,
    y,
    infoW,
    boldFont,
    regularFont,
  ));
  adv(drawLabelValue(
    page,
    'เจ้าหน้าที่ตรวจสอบ: ',
    model.officerName,
    infoX,
    y,
    infoW,
    boldFont,
    regularFont,
  ));
  adv(drawLabelValue(page, 'ห้อง/เลขที่ห้อง: ', model.roomNo, infoX, y, infoW, boldFont, regularFont));
  adv(drawLabelValue(page, 'เลขที่แปลง: ', model.plotNo, infoX, y, infoW, boldFont, regularFont));

  //ปิดการแสดงข้อมูลลูกค้าและผู้รับมอบอำนาจออก
  // const colW = infoW * 0.62;
  // const h1 = drawLabelValue(page, 'ชื่อลูกค้า: ', model.customerName, infoX, y, colW, boldFont, regularFont);
  // const h2 = drawLabelValue(page, 'Tel: ', model.customerPhone, infoX + colW, y, infoW - colW, boldFont, regularFont);
  // adv(Math.max(h1, h2));

  // const h3 = drawLabelValue(
  //   page,
  //   'ผู้รับมอบอำนาจ: ',
  //   model.authorizedName,
  //   infoX,
  //   y,
  //   colW,
  //   boldFont,
  //   regularFont,
  // );
  // const h4 = drawLabelValue(
  //   page,
  //   'Tel: ',
  //   model.authorizedPhone,
  //   infoX + colW,
  //   y,
  //   infoW - colW,
  //   boldFont,
  //   regularFont,
  // );

  // const contentBottom = y + Math.max(h3, h4) + mm(3);
  const contentBottom = y + mm(3);
  const actualBoxHeight = Math.max(INFO_BOX_HEIGHT, contentBottom - INFO_BOX_TOP);

  drawRectTop(page, PAGE_MARGIN_X, INFO_BOX_TOP, CONTENT_WIDTH, actualBoxHeight);
  drawLineTop(page, dividerX, INFO_BOX_TOP, dividerX, INFO_BOX_TOP + actualBoxHeight);

  if (planImage) {
    const frame = drawContainedImage(
      page,
      planImage,
      planX,
      INFO_BOX_TOP,
      PLAN_WIDTH,
      actualBoxHeight,
      mm(2),
    );
    model.rows.forEach((row) => {
      if (row.point) {
        drawPin(page, row.point, row.no, frame, boldFont);
      }
    });
  }

  return INFO_BOX_TOP + actualBoxHeight;
}

function drawTableHeader(page: PDFPage, yTop: number, boldFont: PDFFont) {
  drawRectTop(page, PAGE_MARGIN_X, yTop, CONTENT_WIDTH, TABLE_HEADER_HEIGHT, HEAD_FILL);
  const titles = ['เลข', 'รายการรอการแก้ไข', 'รูปก่อน', 'รูปหลัง'];
  const widths = [COL_NO, COL_ITEM, COL_BEFORE, COL_AFTER];
  let cx = PAGE_MARGIN_X;
  titles.forEach((title, index) => {
    if (index > 0) drawLineTop(page, cx, yTop, cx, yTop + TABLE_HEADER_HEIGHT);
    drawText(page, title, cx + mm(2), yTop + mm(2.4), boldFont, BODY_FONT_SIZE, {
      maxWidth: widths[index] - mm(4),
      align: index === 0 ? 'center' : 'left',
    });
    cx += widths[index];
  });
  return yTop + TABLE_HEADER_HEIGHT;
}

function drawRow(
  page: PDFPage,
  row: WorkDetailRow,
  yTop: number,
  planImage: RasterImage | null,
  captureAreaImage: RasterImage | null,
  beforeImage: RasterImage | null,
  afterImage: RasterImage | null,
  boldFont: PDFFont,
  regularFont: PDFFont,
) {
  drawRectTop(page, PAGE_MARGIN_X, yTop, CONTENT_WIDTH, ROW_HEIGHT);
  const xNo = PAGE_MARGIN_X;
  const xItem = xNo + COL_NO;
  const xBefore = xItem + COL_ITEM;
  const xAfter = xBefore + COL_BEFORE;

  drawLineTop(page, xItem, yTop, xItem, yTop + ROW_HEIGHT);
  drawLineTop(page, xBefore, yTop, xBefore, yTop + ROW_HEIGHT);
  drawLineTop(page, xAfter, yTop, xAfter, yTop + ROW_HEIGHT);

  drawText(page, row.no, xNo, yTop + ROW_HEIGHT / 2 - mm(2), boldFont, BODY_FONT_SIZE, {
    maxWidth: COL_NO,
    align: 'center',
  });

  const thumbX = xItem + mm(2);
  const thumbY = yTop + mm(2);
  const thumbH = ROW_HEIGHT - mm(4);
  drawRectTop(page, thumbX, thumbY, ITEM_THUMB_W, thumbH);
  if (captureAreaImage) {
    drawContainedImage(page, captureAreaImage, thumbX, thumbY, ITEM_THUMB_W, thumbH, mm(1.2));
  } else if (planImage && row.point) {
    drawZoomedPlan(
      page,
      planImage,
      thumbX,
      thumbY,
      ITEM_THUMB_W,
      thumbH,
      row.point,
      row.no,
      boldFont,
      mm(1.2),
    );
  } else if (planImage) {
    drawContainedImage(page, planImage, thumbX, thumbY, ITEM_THUMB_W, thumbH, mm(1.2));
  }

  const textX = thumbX + ITEM_THUMB_W + ITEM_TEXT_GAP;
  const textW = COL_ITEM - ITEM_THUMB_W - ITEM_TEXT_GAP - mm(4);
  let ty = yTop + mm(2);
  ty += drawLabelValue(page, 'บริเวณ: ', row.area, textX, ty, textW, boldFont, regularFont);
  ty += drawLabelValue(page, 'ประเภทงาน: ', row.taskType, textX, ty, textW, boldFont, regularFont);
  ty += drawLabelValue(page, 'หมายเหตุ: ', row.note, textX, ty, textW, boldFont, regularFont);
  ty += drawLabelValue(
    page,
    'สถานะ: ',
    row.status,
    textX,
    ty,
    textW,
    boldFont,
    regularFont,
    statusColor(row.status),
  );
  drawLabelValue(page, 'วันที่: ', row.date || '-', textX, ty, textW, boldFont, regularFont);

  const imgPad = mm(2);
  const imgH = ROW_HEIGHT - imgPad * 2;
  const imgW = COL_BEFORE - imgPad * 2;
  if (beforeImage) {
    drawContainedImage(page, beforeImage, xBefore + imgPad, yTop + imgPad, imgW, imgH);
  }
  if (afterImage) {
    drawContainedImage(page, afterImage, xAfter + imgPad, yTop + imgPad, imgW, imgH);
  }

  return yTop + ROW_HEIGHT;
}

const SIGN_DOTS = '(.........................................................)';
const NAME_DOTS = '(ชื่อ.........................................................)';
const DATE_VALUE_DOTS = '.........................................................';

function drawDottedWithValue(
  page: PDFPage,
  template: string,
  value: string,
  x: number,
  yTop: number,
  width: number,
  font: PDFFont,
) {
  let displayTemplate = template;
  if (value) {
    const templateW = font.widthOfTextAtSize(template, BODY_FONT_SIZE);
    const valueW = font.widthOfTextAtSize(value, BODY_FONT_SIZE);
    const firstDot = template.indexOf('.');
    const lastDot = template.lastIndexOf('.');
    if (firstDot >= 0 && lastDot >= firstDot) {
      const prefix = template.slice(0, firstDot);
      const suffix = template.slice(lastDot + 1);
      const prefixW = font.widthOfTextAtSize(prefix, BODY_FONT_SIZE);
      const suffixW = font.widthOfTextAtSize(suffix, BODY_FONT_SIZE);
      const dotW = font.widthOfTextAtSize('.', BODY_FONT_SIZE);
      const neededW = valueW + 2 * prefixW + mm(2);
      if (neededW > templateW) {
        const targetW = Math.min(width - mm(2), neededW);
        const dotsW = Math.max(0, targetW - prefixW - suffixW);
        const dotCount = Math.max(6, Math.floor(dotsW / dotW));
        displayTemplate = `${prefix}${'.'.repeat(dotCount)}${suffix}`;
      }
    }
  }
  drawText(page, displayTemplate, x, yTop, font, BODY_FONT_SIZE, { maxWidth: width, align: 'center' });
  if (value) {
    drawText(page, value, x, yTop - mm(0.4), font, BODY_FONT_SIZE, {
      maxWidth: width,
      align: 'center',
    });
  }
}

const SIGNATURE_BLOCK_HEIGHT = mm(7) + mm(28); // bar + box

// บล็อกลายเซ็น 1 บล็อก (bar หัวข้อ + 2 คอลัมน์) — รับ barText / dateLabel / dateValue
// ใช้ได้ทั้ง "รับทราบรายการ" และ "ดำเนินการแล้วเสร็จ และตรวจรับมอบแล้ว (N รายการ)"
function drawSignatureBlock(
  page: PDFPage,
  yTop: number,
  barText: string,
  dateLabel: string,
  dateValue: string,
  model: WorkCorrectionFullModel,
  boldFont: PDFFont,
  regularFont: PDFFont,
  receiverSign?: RasterImage | null,
  deliverySign?: RasterImage | null,
) {
  const barHeight = mm(7);
  const TABLE_WIDTH = CONTENT_WIDTH * 0.5;
  const TABLE_X = PAGE_MARGIN_X + (CONTENT_WIDTH - TABLE_WIDTH) / 2;
  // drawRectTop(page, PAGE_MARGIN_X, yTop, CONTENT_WIDTH, barHeight);
  // drawText(page, barText, PAGE_MARGIN_X, yTop + mm(1.6), boldFont, BODY_FONT_SIZE, {
  //   maxWidth: CONTENT_WIDTH,
  //   align: 'center',
  // });

  //half width นำเอา sign ลูกค้าออก
  drawRectTop(page, TABLE_X, yTop, TABLE_WIDTH, barHeight);
  drawText(page, barText, TABLE_X, yTop + mm(1.6), boldFont, BODY_FONT_SIZE, {
    maxWidth: TABLE_WIDTH,
    align: 'center',
  });

  const boxTop = yTop + barHeight;
  const boxHeight = mm(28);
  // const half = CONTENT_WIDTH / 2;
  // drawRectTop(page, PAGE_MARGIN_X, boxTop, half, boxHeight);
  // drawRectTop(page, PAGE_MARGIN_X + half, boxTop, half, boxHeight);
  // drawRectTop(page, PAGE_MARGIN_X, boxTop, CONTENT_WIDTH, boxHeight);
  // half width นำเอา sign ลูกค้าออก
  drawRectTop(page, TABLE_X, boxTop, TABLE_WIDTH, boxHeight);
  const dateDisplay = formatThaiBuddhistDate(dateValue);

  //ปิดการแสดงลายเซ็นลูกค้าและผู้รับมอบอำนาจออก
  // const columns: { x: number; title: string; signer: string }[] = [
  //   {
  //     x: PAGE_MARGIN_X,
  //     title: 'ลายเซ็นลูกค้า / ผู้รับมอบอำนาจ',
  //     signer: model.customerSignerName,
  //   },
  //   {
  //     x: PAGE_MARGIN_X + half,
  //     title: 'ลายเซ็นเจ้าหน้าที่ส่งมอบห้อง',
  //     signer: model.officerSignerName,
  //   },
  // ];

  const columns = [
    {
      // x: PAGE_MARGIN_X,
      x: TABLE_X,
      title: 'ลายเซ็นเจ้าหน้าที่ส่งมอบห้อง',
      signer: model.officerSignerName,
      // width: CONTENT_WIDTH,
      width: TABLE_WIDTH,
    },
  ];

  columns.forEach((column) => {
    drawText(page, column.title, column.x, boxTop + mm(2.5), boldFont, BODY_FONT_SIZE, {
      // maxWidth: half,
      maxWidth: column.width,
      align: 'center',
    });

    const isReceiver = column.title.includes('ลูกค้า');
    const signatureImage = isReceiver ? receiverSign : deliverySign;

    // วาดรูปลายเซ็นก่อน (ชั้นล่าง) แล้วค่อยวาดข้อความทับ — กันหัวข้อ/ชื่อถูกภาพบัง
    if (signatureImage) {
      drawContainedImage(
        page,
        signatureImage,
        column.x + mm(5),
        boxTop + mm(5),
        // half - mm(10),
        column.width - mm(10),
        mm(7)
      );
    } else {
      // drawDottedWithValue(page, SIGN_DOTS, '', column.x, boxTop + mm(11), half, regularFont);
      drawDottedWithValue(page, SIGN_DOTS, '', column.x, boxTop + mm(11), column.width, regularFont);

    }

    drawDottedWithValue(
      page,
      NAME_DOTS,
      column.signer,
      column.x,
      boxTop + mm(15.5),
      // half,
      column.width,
      regularFont,
    );
    drawText(page, dateLabel, column.x, boxTop + mm(20), regularFont, SMALL_FONT_SIZE, {
      // maxWidth: half,
      maxWidth: column.width,
      align: 'center',
    });
    drawDottedWithValue(
      page,
      DATE_VALUE_DOTS,
      dateDisplay,
      column.x,
      boxTop + mm(23.5),
      // half,
      column.width,
      regularFont,
    );
  });

  return boxTop + boxHeight;
}

function drawRemarks(
  page: PDFPage,
  yTop: number,
  remarks: string[],
  boldFont: PDFFont,
  regularFont: PDFFont,
) {
  let y = yTop;
  y += drawText(page, 'หมายเหตุ:', PAGE_MARGIN_X, y, boldFont, BODY_FONT_SIZE);
  remarks.forEach((remark, index) => {
    y += drawText(
      page,
      `${index + 1}. ${remark}`,
      PAGE_MARGIN_X + mm(2),
      y,
      regularFont,
      BODY_FONT_SIZE,
      { maxWidth: CONTENT_WIDTH - mm(2) },
    );
  });
  return y;
}


function computeTotalPages(rowCount: number) {
  const page1Top = INFO_BOX_TOP + INFO_BOX_HEIGHT + mm(8) + TABLE_HEADER_HEIGHT;
  const pageBottom = PAGE_HEIGHT - PAGE_MARGIN_Y - mm(4);
  const firstPageRows = Math.max(1, Math.floor((pageBottom - page1Top) / ROW_HEIGHT));

  if (rowCount <= firstPageRows) {
    return 1;
  }

  const nextTop = PAGE_MARGIN_Y + COMPACT_HEADER_HEIGHT + TABLE_HEADER_HEIGHT;
  const perNextPage = Math.max(1, Math.floor((pageBottom - nextTop) / ROW_HEIGHT));
  return 1 + Math.ceil((rowCount - firstPageRows) / perNextPage);
}

export async function exportWorkCorrectionFullDocumentToPdf(
  model: WorkCorrectionFullModel = WORK_CORRECTION_FULL_OPEN_FILL_MOCK_MODEL,
  fileName?: string,
) {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);

  const [lightBytes, boldBytes, logoBytes] = await Promise.all([
    loadLightFont(),
    loadBoldFont(),
    loadLogo(),
  ]);
  const regularFont = await pdfDoc.embedFont(lightBytes, { subset: true });
  const boldFont = await pdfDoc.embedFont(boldBytes, { subset: true });
  const logo = await pdfDoc.embedPng(logoBytes);
  const embedImage = createImageEmbedder(pdfDoc);
  const planImage = await embedImage(model.planImage);

  // Load signatures if defectId is present
  let receiverOpenSign: RasterImage | null = null;
  let deliveryOpenSign: RasterImage | null = null;
  let receiverCloseSign: RasterImage | null = null;
  let deliveryCloseSign: RasterImage | null = null;

  if (model.defectId) {
    try {
      const sig = await getDefectSignedOpen(model.defectId, 'RECEIVER_SIGN', 'O');
      if (sig?.payload) {
        receiverOpenSign = await embedImage(`data:image/png;base64,${sig.payload}`);
      }
    } catch (e) {
      console.warn('[pdf] load receiver open sign failed:', e);
    }
    try {
      const sig = await getDefectSignedOpen(model.defectId, 'DELIVERY_SIGN', 'O');
      if (sig?.payload) {
        deliveryOpenSign = await embedImage(`data:image/png;base64,${sig.payload}`);
      }
    } catch (e) {
      console.warn('[pdf] load delivery open sign failed:', e);
    }
    try {
      const sig = await getDefectSignedOpen(model.defectId, 'RECEIVER_SIGN', 'C');
      if (sig?.payload) {
        receiverCloseSign = await embedImage(`data:image/png;base64,${sig.payload}`);
      }
    } catch (e) {
      console.warn('[pdf] load receiver close sign failed:', e);
    }
    try {
      const sig = await getDefectSignedOpen(model.defectId, 'DELIVERY_SIGN', 'C');
      if (sig?.payload) {
        deliveryCloseSign = await embedImage(`data:image/png;base64,${sig.payload}`);
      }
    } catch (e) {
      console.warn('[pdf] load delivery close sign failed:', e);
    }
  }

  const totalPages = computeTotalPages(model.rows.length);
  const pageBottom = PAGE_HEIGHT - PAGE_MARGIN_Y - mm(4);

  let pageIndex = 1;
  let page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  drawDocumentHeader(page, model, logo, boldFont, pageIndex, totalPages);
  const infoBottom = drawInfoBox(page, model, planImage, boldFont, regularFont);
  const sectionTitle = (model.documentTitle?.includes('แจ้งซ่อม') || model.workTypeLabel?.includes('แจ้งซ่อม'))
    ? 'รายการแจ้งซ่อม:'
    : 'รายการเก็บรายละเอียดงาน:';
  let currentY = drawText(
    page,
    sectionTitle,
    PAGE_MARGIN_X,
    infoBottom + mm(4),
    boldFont,
    BODY_FONT_SIZE,
  );
  currentY = infoBottom + mm(4) + currentY + mm(1);
  currentY = drawTableHeader(page, currentY, boldFont);

  for (const row of model.rows) {
    if (currentY + ROW_HEIGHT > pageBottom) {
      pageIndex += 1;
      page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      drawDocumentHeader(page, model, logo, boldFont, pageIndex, totalPages);
      currentY = drawTableHeader(page, PAGE_MARGIN_Y + COMPACT_HEADER_HEIGHT, boldFont);
    }

    const [captureAreaImage, beforeImage, afterImage] = await Promise.all([
      embedImage(row.captureAreaImage ?? null),
      embedImage(row.beforeImage),
      embedImage(row.afterImage),
    ]);
    currentY = drawRow(
      page,
      row,
      currentY,
      planImage,
      captureAreaImage,
      beforeImage,
      afterImage,
      boldFont,
      regularFont,
    );
  }

  // close: เพิ่มบล็อก "ดำเนินการแล้วเสร็จ และตรวจรับมอบแล้ว (N รายการ)"
  //  - N นับเฉพาะแถวที่สถานะ = "ปิดรายการ" เท่านั้น
  const isClose = model.variant === 'close';
  const closedCount = model.rows.filter((row) => isWorkDetailStatusCompleted(row.status)).length;

  // _เปิด/ต้นฉบับ: บล็อกลายเซ็นเดียว + หมายเหตุ
  // ปิดรอบ: บล็อก "รับทราบรายการ" + "ดำเนินการแล้วเสร็จ..." + หมายเหตุ
  const footerHeight =
    SIGNATURE_BLOCK_HEIGHT +
    (isClose ? mm(4) + SIGNATURE_BLOCK_HEIGHT : 0) +
    mm(6) + // gap ก่อนหมายเหตุ
    mm(4) * (model.remarks.length + 1);
  let footerY = currentY + mm(6);
  if (footerY + footerHeight > pageBottom) {
    pageIndex += 1;
    page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    drawDocumentHeader(page, model, logo, boldFont, pageIndex, totalPages);
    footerY = PAGE_MARGIN_Y + COMPACT_HEADER_HEIGHT;
  }

  footerY = drawSignatureBlock(
    page,
    footerY,
    model.signatureBarText,
    'วันที่ตรวจเปิดรายการ',
    model.signedDateValue,
    model,
    boldFont,
    regularFont,
    receiverOpenSign,
    deliveryOpenSign,
  );

  if (isClose) {
    footerY += mm(4);
    footerY = drawSignatureBlock(
      page,
      footerY,
      `ดำเนินการแล้วเสร็จ และตรวจรับมอบแล้ว (${closedCount} รายการ)`,
      'วันที่ตรวจรับรายการ',
      model.receiveSignedDateValue,
      model,
      boldFont,
      regularFont,
      receiverCloseSign,
      deliveryCloseSign,
    );
  }

  footerY += mm(6);
  drawRemarks(page, footerY, model.remarks, boldFont, regularFont);

  const pdfBytes = await pdfDoc.save();
  await downloadPdf(pdfBytes, `${fileName?.trim() || getWorkCorrectionFullPdfFileName(model)}.pdf`);
}
