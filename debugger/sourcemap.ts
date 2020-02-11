//MIT License
//
//Copyright (c) 2020 Tom Blind
//
//Permission is hereby granted, free of charge, to any person obtaining a copy
//of this software and associated documentation files (the "Software"), to deal
//in the Software without restriction, including without limitation the rights
//to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
//copies of the Software, and to permit persons to whom the Software is
//furnished to do so, subject to the following conditions:
//
//The above copyright notice and this permission notice shall be included in all
//copies or substantial portions of the Software.
//
//THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
//IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
//FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
//AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
//LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
//OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
//SOFTWARE.

import {Path} from "./path";

export interface SourceLineMapping {
    sourceIndex: number;
    sourceLine: number;
    sourceColumn: number;
}

export interface SourceMap {
    [line: number]: SourceLineMapping | undefined;
    sources: string[];
}

export namespace SourceMap
{
    const cache: { [file: string]: SourceMap | false | undefined } = {};

    const base64Lookup: { [char: string]: number } = {
        A: 0, B: 1, C: 2, D: 3, E: 4, F: 5, G: 6, H: 7,
        I: 8, J: 9, K: 10, L: 11, M: 12, N: 13, O: 14, P: 15,
        Q: 16, R: 17, S: 18, T: 19, U: 20, V: 21, W: 22, X: 23,
        Y: 24, Z: 25, a: 26, b: 27, c: 28, d: 29, e: 30, f: 31,
        g: 32, h: 33, i: 34, j: 35, k: 36, l: 37, m: 38, n: 39,
        o: 40, p: 41, q: 42, r: 43, s: 44, t: 45, u: 46, v: 47,
        // tslint:disable-next-line:object-literal-key-quotes
        w: 48, x: 49, y: 50, z: 51, "0": 52, "1": 53, "2": 54, "3": 55,
        // tslint:disable-next-line:object-literal-key-quotes
        "4": 56, "5": 57, "6": 58, "7": 59, "8": 60, "9": 61, "+": 62, "/": 63,
        "=": 0
    };

    function base64Decode(input: string) {
        const results: string[] = [];
        const bits: boolean[] = [];
        for (const [c] of input.gmatch(".")) {
            let sextet = assert(base64Lookup[c]);
            for (const i of forRange(1, 6)) {
                const bit = sextet % 2 !== 0;
                table.insert(bits, i, bit);
                sextet = math.floor(sextet / 2);
            }
            if (bits.length >= 8) {
                let value = 0;
                for (const i of forRange(7, 0, -1)) {
                    const bit = table.remove(bits);
                    if (bit) {
                        value += (2 ** i);
                    }
                }
                table.insert(results, string.char(value));
            }
        }
        return table.concat(results);
    }

    function decodeBase64VLQ(input: string) {
        const values: number[] = [];
        let bits: boolean[] = [];
        for (const [c] of input.gmatch(".")) {
            let sextet = assert(base64Lookup[c]);
            for (const _ of forRange(1, 5)) {
                const bit = sextet % 2 !== 0;
                table.insert(bits, bit);
                sextet = math.floor(sextet / 2);
            }
            const continueBit = sextet % 2 !== 0;
            if (!continueBit) {
                let value = 0;
                for (const i of forRange(1, bits.length - 1)) {
                    if (bits[i]) {
                        value += (2 ** (i - 1));
                    }
                }
                if (bits[0]) {
                    value = -value;
                }
                table.insert(values, value);
                bits = [];
            }
        }
        return values;
    }

    function build(data: string) {
        const [sources] = data.match('"sources"%s*:%s*(%b[])');
        const [mappings] = data.match('"mappings"%s*:%s*"([^"]+)"');
        const [sourceRoot] = data.match('"sourceRoot"%s*:%s*"([^"]+)"');
        if (!mappings || !sources) {
            return undefined;
        }

        const sourceMap: SourceMap = {sources: []};

        for (let [source] of sources.gmatch('"([^"]+)"')) {
            if (sourceRoot) {
                source = `${sourceRoot}${Path.separator}${source}`;
            }
            table.insert(sourceMap.sources, Path.getAbsolute(source));
        }

        let line = 1;
        let sourceIndex = 0;
        let sourceLine = 1;
        let sourceColumn = 1;
        for (const [mapping, separator] of mappings.gmatch("([^;,]*)([;,]?)")) {
            if (mapping.length > 0) {
                const [colOffset, sourceOffset, sourceLineOffset, sourceColOffset] = decodeBase64VLQ(mapping);
                sourceIndex += (sourceOffset || 0);
                sourceLine += (sourceLineOffset || 0);
                sourceColumn += (sourceColOffset || 0);

                const lineMapping = sourceMap[line];
                if (!lineMapping
                    || sourceLine < lineMapping.sourceLine
                    || (sourceLine === lineMapping.sourceLine && sourceColumn < lineMapping.sourceColumn)
                ) {
                    sourceMap[line] = {sourceIndex, sourceLine, sourceColumn};
                }
            }

            if (separator === ";") {
                ++line;
            }
        }

        return sourceMap;
    }

    export function get(file: string): SourceMap | undefined {
        if (file === "[C]") {
            return undefined;
        }

        let sourceMap = cache[file];

        if (sourceMap === undefined) {
            sourceMap = false;

            //Look for map file
            const mapFile = file + ".map";
            let [f] = io.open(mapFile);
            if (f) {
                const data = f.read("*a");
                f.close();
                sourceMap = build(data) || false;

            //Look for inline map
            } else {
                [f] = io.open(file);
                if (f) {
                    const data = f.read("*a");
                    f.close();
                    const [encodedMap] = data.match(
                        "--# sourceMappingURL=data:application/json;base64,([A-Za-z0-9+/=]+)%s*$"
                    );
                    if (encodedMap) {
                        const map = base64Decode(encodedMap);
                        sourceMap = build(map) || false;
                    }
                }
            }

            cache[file] = sourceMap;
        }

        return sourceMap || undefined;
    }
}
