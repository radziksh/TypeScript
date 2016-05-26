/// <reference path="..\..\..\src\harness\harness.ts" />
/// <reference path="..\..\..\src\compiler\commandLineParser.ts" />

namespace ts {
    class MockParseConfigHost extends Utils.VirtualFileSystem implements ParseConfigHost {
        constructor(currentDirectory: string, ignoreCase: boolean, files: string[]) {
            super(currentDirectory, ignoreCase);
            for (const file of files) {
                this.addFile(file);
            }
        }

        readDirectory(path: string, extensions: string[], excludes: string[], includes: string[]) {
            return matchFiles(path, extensions, excludes, includes, this.useCaseSensitiveFileNames, this.currentDirectory, (path: string) => this.getAccessibleFileSystemEntries(path));
        }

        getAccessibleFileSystemEntries(path: string) {
            const entry = this.traversePath(path);
            if (entry && entry.isDirectory()) {
                const directory = <Utils.VirtualDirectory>entry;
                return {
                    files: map(directory.getFiles(), f => f.name),
                    directories: map(directory.getDirectories(), d => d.name)
                };
            }
            return { files: [], directories: [] };
        }
    }

    describe('parseConfigFileTextToJson', () => {
        function assertParseResult(jsonText: string, expectedConfigObject: { config?: any; error?: Diagnostic }) {
            let parsed = ts.parseConfigFileTextToJson("/apath/tsconfig.json", jsonText);
            assert.equal(JSON.stringify(parsed), JSON.stringify(expectedConfigObject));
        }

        function assertParseError(jsonText: string) {
             let parsed = ts.parseConfigFileTextToJson("/apath/tsconfig.json", jsonText);
             assert.isTrue(undefined === parsed.config);
             assert.isTrue(undefined !== parsed.error);
        }

        function assertParseErrorWithExcludesKeyword(jsonText: string) {
             let parsed = ts.parseConfigFileTextToJson("/apath/tsconfig.json", jsonText);
             let parsedCommand = ts.parseJsonConfigFileContent(parsed, ts.sys, "tests/cases/unittests");
             assert.isTrue(undefined !== parsedCommand.errors);
        }

        function assertParseFileList(jsonText: string, configFileName: string, basePath: string, allFileList: string[], expectedFileList: string[]) {
            const json = JSON.parse(jsonText);
            const host: ParseConfigHost = new MockParseConfigHost(basePath, true, allFileList);
            const parsed = ts.parseJsonConfigFileContent(json, host, basePath, /*existingOptions*/ undefined, configFileName);
            assert.isTrue(arrayIsEqualTo(parsed.fileNames.sort(), expectedFileList.sort()));
        }

        it("returns empty config for file with only whitespaces", () => {
            assertParseResult("", { config : {} });
            assertParseResult(" ", { config : {} });
        });

        it("returns empty config for file with comments only", () => {
            assertParseResult("// Comment", { config: {} });
            assertParseResult("/* Comment*/", { config: {} });
        });

        it("returns empty config when config is empty object", () => {
            assertParseResult("{}", { config: {} });
        });

        it("returns config object without comments", () => {
            assertParseResult(
                `{ // Excluded files
                    "exclude": [
                        // Exclude d.ts
                        "file.d.ts"
                    ]
                }`, { config: { exclude: ["file.d.ts"] } });

            assertParseResult(
                `{
                    /* Excluded
                         Files
                    */
                    "exclude": [
                        /* multiline comments can be in the middle of a line */"file.d.ts"
                    ]
                }`, { config: { exclude: ["file.d.ts"] } });
        });

        it("keeps string content untouched", () => {
            assertParseResult(
                `{
                    "exclude": [
                        "xx//file.d.ts"
                    ]
                }`, { config: { exclude: ["xx//file.d.ts"] } });
         assertParseResult(
                `{
                    "exclude": [
                        "xx/*file.d.ts*/"
                    ]
                }`, { config: { exclude: ["xx/*file.d.ts*/"] } });
        });

        it("handles escaped characters in strings correctly", () => {
            assertParseResult(
                `{
                    "exclude": [
                        "xx\\"//files"
                    ]
                }`, { config: { exclude: ["xx\"//files"] } });

            assertParseResult(
                `{
                    "exclude": [
                        "xx\\\\" // end of line comment
                    ]
                }`, { config: { exclude: ["xx\\"] } });
         });

        it("returns object with error when json is invalid", () => {
             assertParseError("invalid");
        });

        it("returns object when users correctly specify library", () => {
            assertParseResult(
                `{
                    "compilerOptions": {
                        "lib": "es5"
                    }
                }`, {
                    config: { compilerOptions: { lib: "es5" } }
                });

            assertParseResult(
                `{
                    "compilerOptions": {
                        "lib": "es5,es6"
                    }
                }`, {
                    config: { compilerOptions: { lib: "es5,es6" } }
                });
        });

        it("returns error when tsconfig have excludes", () => {
            assertParseErrorWithExcludesKeyword(
                `{
                    "compilerOptions": {
                        "lib": "es5"
                    },
                    "excludes": [
                        "foge.ts"
                    ]
                }`);
        });

        it("ignore dotted files and folders", () => {
            assertParseFileList(
                `{}`,
                "tsconfig.json",
                "/apath",
                ["/apath/test.ts", "/apath/.git/a.ts", "/apath/.b.ts", "/apath/..c.ts"],
                ["/apath/test.ts"]
            )
        });

        it("allow dotted files and folders when explicitly requested", () => {
            assertParseFileList(
                `{
                    "files": ["/apath/.git/a.ts", "/apath/.b.ts", "/apath/..c.ts"]
                }`,
                "tsconfig.json",
                "/apath",
                ["/apath/test.ts", "/apath/.git/a.ts", "/apath/.b.ts", "/apath/..c.ts"],
                ["/apath/.git/a.ts", "/apath/.b.ts", "/apath/..c.ts"]
            )
        });

        it("always exclude outDir", () => {
            const tsconfigWithoutExclude =
            `{
                "compilerOptions": {
                    "outDir": "bin"
                }
            }`;
            const tsconfigWithExclude =
            `{
                "compilerOptions": {
                    "outDir": "bin"
                },
                "exclude": [ "obj" ]
            }`;
            const rootDir = "/";
            const allFiles = ["/bin/a.ts", "/b.ts"];
            const expectedFiles = ["/b.ts"];
            assertParseFileList(tsconfigWithoutExclude, "tsconfig.json", rootDir, allFiles, expectedFiles);
            assertParseFileList(tsconfigWithExclude, "tsconfig.json", rootDir, allFiles, expectedFiles);
        })

        it("implicitly exclude common package folders", () => {
            assertParseFileList(
                `{}`,
                "tsconfig.json",
                "/",
                ["/node_modules/a.ts", "/bower_components/b.ts", "/jspm_packages/c.ts", "/d.ts", "/folder/e.ts"],
                ["/d.ts", "/folder/e.ts"]
            )
        })
    });
}
