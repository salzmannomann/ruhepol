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
    // Erweiterung 1.28: Erreichbarkeit geprüft, Startseiten ohne Nachrichtenteil
    // Elektronik / Technik
    'saturn.at', 'notebooksbilliger.de', 'alternate.at', 'alternate.de', 'computeruniverse.net', 'arlt.com',
    'mindfactory.de', 'caseking.de', 'reichelt.de', 'reichelt.at', 'pollin.de', 'digitec.ch', 'interdiscount.ch',
    'fust.ch', 'melectronics.ch', 'expert.at', 'expert.de', 'euronics.de', 'hartlauer.at', 'red-zac.at',
    'electronic4you.at', 'mytoys.de', 'proshop.at', 'proshop.de', 'dell.com', 'lenovo.com', 'hp.com', 'logitech.com',
    'sonos.com', 'bose.de', 'dyson.at', 'dyson.de', 'miele.at', 'miele.de', 'bosch-home.at', 'bosch-home.com',
    // Möbel / Wohnen / Garten / Baumarkt
    'home24.at', 'home24.de', 'westwing.at', 'westwing.de', 'butlers.com', 'dehner.at', 'dehner.de', 'bellaflora.at',
    'toom.de', 'hagebau.at', 'hagebau.de', 'globus-baumarkt.de', 'bauhaus.info', 'hellweg.de', 'jysk.at', 'jysk.de',
    'segmueller.de', 'roller.de', 'poco.de', 'porta.de', 'ikea.at', 'lutz.at', 'moemax.de', 'xxxlutz.de',
    'wayfair.de', 'wayfair.com', 'otto.at', 'universal.at', 'quelle.at', 'baur.de', 'heine.de', 'bonprix.at',
    'bonprix.de', 'witt-weiden.de', 'klingel.de', 'impressionen.de',
    // Drogerie / Apotheke / Beauty
    'rossmann.de', 'dm.de', 'mueller.ch', 'shop-apotheke.at', 'shop-apotheke.com', 'docmorris.de',
    'medikamente-per-klick.de', 'aponeo.de', 'vamida.at', 'sephora.de', 'flaconi.de', 'flaconi.at', 'notino.at',
    'notino.de', 'parfumdreams.de', 'marionnaud.at', 'yves-rocher.at', 'lush.com', 'rituals.com',
    // Mode / Schuhe / Sport
    'asos.com', 'zara.com', 'mango.com', 'uniqlo.com', 'primark.com', 'bershka.com', 'pullandbear.com',
    'stradivarius.com', 'massimodutti.com', 'tom-tailor.at', 'tom-tailor.de', 'jackjones.com', 'only.com',
    'snipes.com', 'footlocker.at', 'footlocker.de', 'zalando-lounge.at', 'zalando-lounge.de', 'bergzeit.at',
    'bergzeit.de', 'sportscheck.com', 'decathlon.at', 'decathlon.de', 'bike24.de', 'bike-discount.de', 'rosebikes.at',
    'rosebikes.de', 'fahrrad.de', 'bikester.at', 'bikester.de', 'nike.com', 'adidas.at', 'adidas.de', 'puma.com',
    'northface.com', 'jack-wolfskin.at', 'jack-wolfskin.de', 'gigasport.at', 'mirapodo.de', 'goertz.de', 'reno.de',
    'deichmann.at', 'ochsnershoes.ch', 'about-you.ch', 'tchibo.ch', 'lidl.ch', 'aldi-suisse.ch', 'aldi-sued.de',
    'aldi-nord.de',
    // Spielwaren / Bücher / Medien
    'lego.com', 'playmobil.at', 'playmobil.de', 'thalia.ch', 'weltbild.at', 'weltbild.de', 'hugendubel.de',
    'buecher.de', 'orellfuessli.ch', 'exlibris.ch', 'medimops.de', 'rebuy.de', 'momox.de', 'cdon.com',
    // Lebensmittel / Lieferung
    'gurkerl.at', 'billa-plus.at', 'mpreis.at', 'unimarkt.at', 'penny.at', 'penny.de', 'rewe.de', 'edeka.de',
    'kaufland.de', 'kaufland.at', 'netto-online.de', 'migros.ch', 'coop.ch', 'lieferando.at', 'lieferando.de',
    'mjam.net', 'foodora.at', 'wolt.com', 'hellofresh.at', 'hellofresh.de', 'marleyspoon.at',
    // Tierbedarf / Hobby
    'zooplus.at', 'zooplus.de', 'fressnapf.ch', 'zoo-zajac.de', 'idee-shop.at', 'idee-shop.com', 'modulor.de',
    'gerstaecker.de',
    // Reisen / Hotels / Mobilität
    'hotels.com', 'agoda.com', 'kayak.at', 'kayak.de', 'skyscanner.at', 'skyscanner.de', 'momondo.at', 'momondo.de',
    'opodo.at', 'opodo.de', 'edreams.de', 'lastminute.at', 'lastminute.de', 'weg.de', 'tui.at', 'tui.com', 'ruefa.at',
    'verkehrsbuero.at', 'hofer-reisen.at', 'lidl-reisen.at', 'lidl-reisen.de', 'urlaubspiraten.at',
    'urlaubspiraten.de', 'travelcircus.de', 'secretescapes.de', 'eurowings.com', 'easyjet.com', 'condor.com',
    'swiss.com', 'sbb.ch', 'db.de', 'omio.at', 'omio.de', 'trainline.com', 'sixt.at', 'sixt.de', 'europcar.at',
    'hertz.at', 'avis.at', 'billiger-mietwagen.de', 'fewo-direkt.de', 'vrbo.com', 'hometogo.at', 'hometogo.de',
    'interhome.at', 'novasol.at',
    // Immobilien / Jobs / Autos
    'immo.at', 'findmyhome.at', 'wohnnet.at', 'immonet.de', 'kleinanzeigen.at', 'immobilien.net', 'jobs.at',
    'hokify.at', 'monster.at', 'monster.de', 'jobware.de', 'stellenanzeigen.de', 'autoscout24.ch', 'car4you.at',
    'pkw.de', 'autohero.com', 'carwow.de', 'mobile.at',
    // Preisvergleich / Gutscheine / Marktplätze
    'billiger.de', 'check24.at', 'durchblicker.at', 'toppreise.ch', 'ricardo.ch', 'tutti.ch', 'anibis.ch', 'quoka.de',
    'markt.de', 'gutscheine.at', 'gutscheinsammler.de', 'groupon.at', 'groupon.de', 'dealabs.com',
    // Rezepte / DIY
    'kochbar.de', 'lecker.de', 'essen-und-trinken.de', 'springlane.de', 'eatsmarter.de', 'kitchenstories.com',
    'allrecipes.com', 'selbst.de', 'obi.com',
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
