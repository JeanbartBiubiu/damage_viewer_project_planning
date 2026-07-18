import { describe, expect, it } from 'vitest';
import { normalizeImageAssetUri } from './resourceImage';
import {
  clearImageReference,
  createCopiedImageReference,
  createUntouchedImageReference,
  displayImageUri,
  isImageReferenceTouched,
  normalizeLoadedImageUri,
  revertImageReference,
  serializeImageUriPatch,
  setExactImageReference
} from './combatDataImageReference';

describe('combatDataImageReference loaded original', () => {
  it('normalizes undefined/null/blank original to null', () => {
    expect(normalizeLoadedImageUri(undefined)).toBeNull();
    expect(normalizeLoadedImageUri(null)).toBeNull();
    expect(normalizeLoadedImageUri('')).toBeNull();
    expect(normalizeLoadedImageUri('   ')).toBeNull();
  });

  it('keeps exact nonblank original including surrounding whitespace', () => {
    expect(normalizeLoadedImageUri('character_vayne')).toBe('character_vayne');
    // trim only classifies blank; nonblank originals stay byte-for-byte
    expect(normalizeLoadedImageUri('  keep_me  ')).toBe('  keep_me  ');
  });

  it('createUntouched starts preserve with null or exact original', () => {
    expect(createUntouchedImageReference(undefined)).toEqual({
      status: 'untouched',
      original: null
    });
    expect(createUntouchedImageReference(null)).toEqual({
      status: 'untouched',
      original: null
    });
    expect(createUntouchedImageReference('hero_icon')).toEqual({
      status: 'untouched',
      original: 'hero_icon'
    });
  });
});

describe('combatDataImageReference serialize three-state', () => {
  it('untouched omits imageUri entirely', () => {
    const state = createUntouchedImageReference('existing_uri');
    expect(serializeImageUriPatch(state)).toEqual({});
    expect(Object.keys(serializeImageUriPatch(state))).toEqual([]);
    expect(isImageReferenceTouched(state)).toBe(false);
  });

  it('explicit clear serializes { imageUri: null }', () => {
    const state = clearImageReference(createUntouchedImageReference('existing_uri'));
    expect(serializeImageUriPatch(state)).toEqual({ imageUri: null });
    expect(isImageReferenceTouched(state)).toBe(true);
    expect(displayImageUri(state)).toBeNull();
  });

  it('empty and whitespace-only input serializes clear/null', () => {
    const base = createUntouchedImageReference('existing');
    expect(serializeImageUriPatch(setExactImageReference(base, ''))).toEqual({ imageUri: null });
    expect(serializeImageUriPatch(setExactImageReference(base, '   '))).toEqual({ imageUri: null });
    expect(serializeImageUriPatch(setExactImageReference(base, '\t\n'))).toEqual({ imageUri: null });
  });

  it('exact nonblank preserves leading/trailing whitespace byte-for-byte', () => {
    const exact = '  character_vayne  ';
    const state = setExactImageReference(createUntouchedImageReference(null), exact);
    expect(state).toEqual({
      status: 'set',
      original: null,
      value: exact
    });
    expect(serializeImageUriPatch(state)).toEqual({ imageUri: exact });
    expect(displayImageUri(state)).toBe(exact);
  });

  it('revert restores untouched/preserve', () => {
    const loaded = createUntouchedImageReference('orig');
    const edited = setExactImageReference(loaded, 'other');
    expect(serializeImageUriPatch(edited)).toEqual({ imageUri: 'other' });
    const reverted = revertImageReference(edited);
    expect(reverted).toEqual({ status: 'untouched', original: 'orig' });
    expect(serializeImageUriPatch(reverted)).toEqual({});
  });
});

describe('combatDataImageReference copy draft', () => {
  it('intentionally sets exact binding when source has a URI', () => {
    const copied = createCopiedImageReference('character_vayne');
    expect(copied.status).toBe('set');
    expect(serializeImageUriPatch(copied)).toEqual({ imageUri: 'character_vayne' });
  });

  it('stays untouched when source has no binding', () => {
    expect(createCopiedImageReference(null)).toEqual({ status: 'untouched', original: null });
    expect(serializeImageUriPatch(createCopiedImageReference(undefined))).toEqual({});
  });
});

describe('combatDataImageReference does not reuse upload URI validation', () => {
  it('serializes values that normalizeImageAssetUri would reject', () => {
    const weird = '  has space and:colon  ';
    expect(normalizeImageAssetUri(weird)).toBeNull();
    const state = setExactImageReference(createUntouchedImageReference(null), weird);
    expect(serializeImageUriPatch(state)).toEqual({ imageUri: weird });
  });
});
