'use strict';

const { summarizeD365WriteError } = require('./d365ErrorSummary');

const PROD_FIXTURE = "D365 OData request failed (400): /data/PurchaseOrderLinesV2(dataAreaId='whsl',PurchaseOrderNumber='WSPO-0422062',LineNumber=20): Write failed for table row of type 'PurchPurchaseOrderLineV2Entity'. Infolog: Warning: Item 'L-10780-02' is blocked for 'Purchase order'.; Warning: validateWrite failed on data source 'PurchLine (PurchLine)'.";

describe('summarizeD365WriteError', () => {
  it('haalt de Infolog-reden uit de PROD-melding van 2026-10-09', () => {
    expect(summarizeD365WriteError(PROD_FIXTURE)).toBe("Item 'L-10780-02' is blocked for 'Purchase order'.");
  });

  it('dedupliceert en combineert meerdere Infolog-regels', () => {
    const msg = "D365 OData request failed (400): /data/PurchaseOrderLinesV2(dataAreaId='a',PurchaseOrderNumber='P',LineNumber=1): Infolog: Error: Price is missing.; Warning: Price is missing.; Error: Site is closed.";
    expect(summarizeD365WriteError(msg)).toBe('Price is missing. Site is closed.');
  });

  it('strip prefix en entity-pad als er geen Infolog is', () => {
    const msg = "D365 OData request failed (400): /data/PurchaseOrderLinesV2(dataAreaId='whsl',PurchaseOrderNumber='PO-1',LineNumber=1): PurchaseOrderName is locked";
    expect(summarizeD365WriteError(msg)).toBe('PurchaseOrderName is locked');
  });

  it('valt terug op het origineel als alleen ruis overblijft', () => {
    const msg = "D365 OData request failed (400): /data/PurchaseOrderLinesV2(dataAreaId='a',PurchaseOrderNumber='P',LineNumber=1): Write failed for table row of type 'X'.";
    expect(summarizeD365WriteError(msg)).toBe(msg);
  });

  it('laat app-meldingen (409 concurrency) ongewijzigd', () => {
    const msg = 'The value changed in D365 since you read it. Refresh first and try again.';
    expect(summarizeD365WriteError(msg)).toBe(msg);
  });

  it('geeft een lege string bij lege input', () => {
    expect(summarizeD365WriteError('')).toBe('');
    expect(summarizeD365WriteError(undefined)).toBe('');
  });
});
