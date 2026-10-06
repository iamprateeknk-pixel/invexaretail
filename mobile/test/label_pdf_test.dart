import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:invexaretail_mobile/models/models.dart';
import 'package:invexaretail_mobile/services/label_pdf.dart';
import 'package:invexaretail_mobile/services/quick_lookup.dart';

const lot = LotRecord(id: 'l1', lotNo: 'LOT-A');
const item = CatalogItem(id: 'i1', code: 'SKU-1', name: 'Rice', barcode: '890100', lots: [lot]);

void main() {
  test('label code prefers lot number, then barcode, then item code', () {
    expect(labelCodeFor(const QuickLookupResult(item: item, lot: lot, onHand: 1)), 'LOT-A');
    expect(labelCodeFor(const QuickLookupResult(item: item, onHand: 1)), '890100');
    const bare = CatalogItem(id: 'i2', code: 'SKU-2', name: 'Milk');
    expect(labelCodeFor(const QuickLookupResult(item: bare, onHand: 1)), 'SKU-2');
  });

  test('builds a PDF with one page per copy', () async {
    final bytes = await buildLabelPdf(const QuickLookupResult(item: item, onHand: 1), copies: 3);
    expect(latin1.decode(bytes.sublist(0, 4)), '%PDF');
    expect(RegExp(r'/Count 3').hasMatch(latin1.decode(bytes, allowInvalid: true)), isTrue);
  });
}
