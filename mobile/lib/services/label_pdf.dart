import 'dart:typed_data';

import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;

import 'quick_lookup.dart';

/// True when [text] has characters the built-in PDF font cannot draw (Hindi,
/// Tamil, Arabic, CJK and so on). Latin with accents, digits and common
/// punctuation (up to U+024F, plus general punctuation and currency) is fine.
bool needsUnicodeFont(String text) {
  for (final rune in text.runes) {
    final latin = rune <= 0x024F;
    final punctuation = rune >= 0x2000 && rune <= 0x20CF;
    if (!latin && !punctuation) return true;
  }
  return false;
}

/// 60 x 35 mm, the same label size the web app prints (web/src/lib/print-labels.js).
const labelPageFormat = PdfPageFormat(60 * PdfPageFormat.mm, 35 * PdfPageFormat.mm, marginAll: 2 * PdfPageFormat.mm);

/// The value encoded in the barcode: the lot number when a lot was scanned,
/// otherwise the item barcode, falling back to the item code.
String labelCodeFor(QuickLookupResult result) {
  final lot = result.lot?.lotNo;
  if (lot != null && lot.isNotEmpty) return lot;
  final barcode = result.item.barcode;
  if (barcode != null && barcode.isNotEmpty) return barcode;
  return result.item.code;
}

/// One page per copy. Code 128 so any printable code encodes, unlike the
/// web's Code 39.
Future<Uint8List> buildLabelPdf(QuickLookupResult result, {int copies = 1, pw.ThemeData? theme}) {
  final doc = pw.Document(title: result.item.name, theme: theme);
  final code = labelCodeFor(result);
  final meta = result.lot == null ? result.item.code : 'LOT ${result.lot!.lotNo}';
  for (var i = 0; i < copies.clamp(1, 100); i++) {
    doc.addPage(
      pw.Page(
        pageFormat: labelPageFormat,
        build: (_) => pw.Column(
          mainAxisAlignment: pw.MainAxisAlignment.center,
          crossAxisAlignment: pw.CrossAxisAlignment.stretch,
          children: [
            pw.Text(result.item.name, maxLines: 1, style: const pw.TextStyle(fontSize: 11, fontWeight: pw.FontWeight.bold)),
            pw.Text(meta, style: const pw.TextStyle(fontSize: 8)),
            pw.SizedBox(height: 2),
            pw.Expanded(child: pw.BarcodeWidget(barcode: pw.Barcode.code128(), data: code, drawText: true, textStyle: const pw.TextStyle(fontSize: 8))),
          ],
        ),
      ),
    );
  }
  return doc.save();
}
