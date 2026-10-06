/// Plain-words labels for the Sync center, so a queued mutation reads as what
/// the person did on the phone, not as an internal type code or API path.
String queuedActionLabel(String type) {
  switch (type) {
    case 'PICK':
      return 'Pick confirmation';
    case 'PUTAWAY':
      return 'Putaway';
    case 'TRANSFER_RECEIVE':
      return 'Transfer receipt';
    default:
      final words = type.toLowerCase().split('_').where((word) => word.isNotEmpty).toList();
      if (words.isEmpty) return 'Saved action';
      words[0] = words[0][0].toUpperCase() + words[0].substring(1);
      return words.join(' ');
  }
}

/// "just now", "5 min ago", "2 h ago", "3 d ago", then the date itself.
String relativeSavedTime(String iso, DateTime now) {
  final saved = DateTime.tryParse(iso);
  if (saved == null) return iso.split('T').first;
  final diff = now.difference(saved.toUtc().isAfter(now.toUtc()) ? now : saved);
  if (diff.inMinutes < 1) return 'just now';
  if (diff.inMinutes < 60) return '${diff.inMinutes} min ago';
  if (diff.inHours < 24) return '${diff.inHours} h ago';
  if (diff.inDays < 7) return '${diff.inDays} d ago';
  return iso.split('T').first;
}
