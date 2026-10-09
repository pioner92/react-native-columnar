import { beforeAll, describe, expect, it } from 'react-native-harness';
import { installBindings, readRows } from './helpers';

beforeAll(() => {
  installBindings();
});

describe('ColumnarWriter after toArrayBuffer()', () => {
  for (const action of ['columns', 'resize', 'toArrayBuffer']) {
    it(`throws a JS error on ${action}() instead of touching released memory`, () => {
      expect(() => __columnarUseAfterRelease(action)).toThrow(
        /writer used after toArrayBuffer/
      );
    });
  }

  it('keeps the runtime usable after the error', () => {
    expect(() => __columnarUseAfterRelease('columns')).toThrow();
    expect(readRows(__columnarRows(3)).rows.length).toBe(3);
  });

  it('rejects invalid arguments with a JS error', () => {
    expect(() => __columnarUseAfterRelease('nope')).toThrow(/unknown action/);
    // @ts-expect-error: wrong argument type on purpose
    expect(() => __columnarRows('10')).toThrow(/row count/);
  });
});
