/*
 * Nachrichtenseite oder nicht? Auf Nicht-Nachrichtenseiten (Marktplätze, Shops, Reisen …) zeigt
 * Ruhepol Bilder sofort und prüft sie im Hintergrund; Texte werden überall gleich geprüft.
 *
 * Reihenfolge: eigene Einstufung der Seite (Popup) → eingebaute Listen → sonst Nachrichtenseite.
 * Eine Erkennung aus dem Seiteninhalt (Shop-/Artikel-Auszeichnung, Zahl der Preise) war gemessen
 * zu unzuverlässig: Startseiten von Shops tragen kaum Merkmale, heise.de galt als Shop.
 *
 * Klassisches Skript: stellt globalThis.SFSiteKind bereit (auch in Node für Tests).
 */
(function (root) {
  'use strict';

  // Immer Nachrichten (auch Unterseiten wie wien.orf.at). Zeitungen, Sender, Agenturen, Portale.
  const NEWS = [
    // Österreich
    'orf.at', 'derstandard.at', 'krone.at', 'kurier.at', 'heute.at', 'oe24.at', 'diepresse.com', 'kleinezeitung.at',
    'salzburg.com', 'sn.at', 'nachrichten.at', 'tt.com', 'vol.at', 'vn.at', 'noen.at', 'meinbezirk.at', 'falter.at',
    'profil.at', 'puls24.at', 'servustv.com', 'atv.at', 'exxpress.at', 'wienerzeitung.at', 'news.at', 'apa.at',
    'trend.at', 'moment.at', 'zackzack.at', 'tips.at', 'bvz.at', 'msn.com', 'news.google.com', 'news.joyn.at',
    'futurezone.at', 'vienna.at', 'salto.bz', 'heise.de', 'golem.de', 'derbrutkasten.com',
    // Deutschland
    'spiegel.de', 'zeit.de', 'faz.net', 'sueddeutsche.de', 'welt.de', 'bild.de', 'tagesschau.de', 'zdf.de', 'zdfheute.de',
    'ard.de', 'br.de', 'ndr.de', 'wdr.de', 'swr.de', 'mdr.de', 'hr.de', 'rbb24.de', 'n-tv.de', 'stern.de', 'focus.de',
    't-online.de', 'tagesspiegel.de', 'handelsblatt.com', 'taz.de', 'fr.de', 'merkur.de', 'tz.de', 'rnd.de',
    'deutschlandfunk.de', 'dw.com', 'web.de', 'gmx.net', 'rp-online.de', 'ksta.de', 'abendblatt.de', 'mopo.de', 'n24.de',
    // Schweiz
    'srf.ch', 'nzz.ch', 'tagesanzeiger.ch', '20min.ch', 'blick.ch', 'watson.ch', 'watson.de', 'aargauerzeitung.ch',
    'luzernerzeitung.ch', 'swissinfo.ch',
    // International
    'bbc.com', 'bbc.co.uk', 'cnn.com', 'nytimes.com', 'theguardian.com', 'washingtonpost.com', 'reuters.com', 'apnews.com',
    'aljazeera.com', 'euronews.com', 'politico.eu', 'politico.com', 'bloomberg.com', 'ft.com', 'wsj.com', 'economist.com',
    'nbcnews.com', 'cbsnews.com', 'abcnews.go.com', 'foxnews.com', 'npr.org', 'lemonde.fr', 'corriere.it', 'elpais.com',
    'news.yahoo.com', 'de.nachrichten.yahoo.com', 'huffpost.com', 'vice.com',
  ];

  // Nie Nachrichten: Marktplätze, Shops, Reisen, Karten, Immobilien, Jobs.
  const CALM = [
    'willhaben.at', 'shpock.com', 'ebay.at', 'ebay.de', 'ebay.com', 'ebay-kleinanzeigen.de', 'kleinanzeigen.de',
    'amazon.at', 'amazon.de', 'amazon.com', 'amazon.co.uk', 'geizhals.at', 'geizhals.de', 'idealo.at', 'idealo.de',
    'zalando.at', 'zalando.de', 'otto.de', 'mediamarkt.at', 'mediamarkt.de', 'saturn.de', 'ikea.com', 'xxxlutz.at',
    'etsy.com', 'aliexpress.com', 'temu.com', 'shein.com', 'about-you.at', 'aboutyou.de', 'galaxus.at', 'galaxus.de',
    'booking.com', 'airbnb.at', 'airbnb.de', 'airbnb.com', 'expedia.at', 'expedia.de', 'trivago.at', 'trivago.de',
    'tripadvisor.at', 'tripadvisor.de', 'checkfelix.com', 'oebb.at', 'bahn.de', 'immobilienscout24.at',
    'immobilienscout24.de', 'immowelt.at', 'immowelt.de', 'karriere.at', 'stepstone.at', 'stepstone.de', 'indeed.com',
    'chefkoch.de', 'ichkoche.at', 'gutekueche.at', 'maps.google.com', 'openstreetmap.org', 'autoscout24.at', 'autoscout24.de',
    'mobile.de', 'gebrauchtwagen.at', 'thomann.de', 'conrad.at', 'conrad.de', 'billa.at', 'spar.at', 'hofer.at', 'dm.at',
    // Handel Österreich/Deutschland
    'interspar.at', 'bipa.at', 'mueller.at', 'mueller.de', 'lidl.at', 'lidl.de', 'tchibo.at', 'tchibo.de', 'hervis.at',
    'intersport.at', 'sportokay.com', 'bergfreunde.de', 'bauhaus.at', 'obi.at', 'obi.de', 'hornbach.at', 'hornbach.de',
    'lagerhaus.at', 'libro.at', 'thalia.at', 'thalia.de', 'morawa.at', 'fressnapf.at', 'fressnapf.de', 'moebelix.at',
    'moemax.at',
    // Mode und Technik
    'hm.com', 'c-and-a.com', 'peek-cloppenburg.at', 'peek-cloppenburg.de', 'deichmann.com', 'humanic.net', 'douglas.at',
    'douglas.de', 'cyberport.at', 'cyberport.de', 'e-tec.at', 'apple.com', 'samsung.com',
    // Reisen
    'austrian.com', 'ryanair.com', 'wizzair.com', 'lufthansa.com', 'flixbus.at', 'flixbus.de', 'flixbus.com', 'westbahn.at',
    'holidaycheck.at', 'holidaycheck.de', 'check24.de',
    // Marktplätze und Schnäppchen
    'vinted.at', 'vinted.de', 'mydealz.de', 'preisjaeger.at',
  ];

  function matchHost(host, list) {
    const h = String(host || '').toLowerCase().replace(/^www\./, '');
    for (const d of list) if (h === d || h.endsWith('.' + d)) return true;
    return false;
  }

  /** Nur nach dem Hostnamen: 'news', 'calm' oder null (unbekannt). overrides: {host: kind}. */
  function hostKind(host, overrides) {
    const h = String(host || '').toLowerCase().replace(/^www\./, '');
    if (overrides) {
      for (const [k, v] of Object.entries(overrides)) {
        if ((v === 'news' || v === 'calm') && (h === k || h.endsWith('.' + k))) return v;
      }
    }
    if (matchHost(h, NEWS)) return 'news';
    if (matchHost(h, CALM)) return 'calm';
    return null;
  }

  /** Nachrichtenseite ('news') oder nicht ('calm'); unbekannte Seiten gelten als Nachrichtenseite. */
  function classify(host, overrides) {
    return hostKind(host, overrides) || 'news';
  }

  root.SFSiteKind = { NEWS, CALM, hostKind, classify };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.SFSiteKind;
})(typeof globalThis !== 'undefined' ? globalThis : this);
