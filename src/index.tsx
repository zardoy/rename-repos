import React, { ComponentProps, useCallback, useEffect, useRef, useState } from "react"
import { Box, render, Static, Text } from "ink"
import { FC } from "react"
import fs from "fs"
import path from "path"
import { getDirsFromCwd, getGithubRemoteInfo } from "./common"
import SelectInput, { Item } from "ink-select-input"

import InkSpinner from "ink-spinner"

import InkTable from "ink-table"

import { program } from "commander"
import readPackageUp from "read-pkg-up"
import { filterWith } from "./util"
import PauseScript from "./pause-script"

// thats how CLI should look like (from UX point of view, not DX)

program.version(readPackageUp.sync()!.packageJson.version)

program
    .option("-d, --dir <path>", "Working directory for scripts", process.cwd())
    .argument("[script]", "run without this argument to see possible script names")

// todo-low (needs testing) add link for dirs support

program.parse()

const cwd: string = program.opts().dir

interface GetOutputProps {
    conrimActionCallback: () => Promise<void>
    setTempOutput: (component: JSX.Element | null) => void
}

const scripts = {
    "all-remote-repos": {
        label: "Show GitHub info for all repos (doesn't use GH API, only local info)",
        getOutput: async () => {
            const { git: gitDirs } = await getDirsFromCwd(cwd)

            const dirsInfo = await Promise.all(
                gitDirs.map(dir => {
                    const repoPath = path.join(cwd, dir)
                    return getGithubRemoteInfo(repoPath)
                })
            )

            type Groups = {
                [user: string]: {
                    [dir: string]: string
                }
            }

            const groupedRepos: Groups = dirsInfo
                .map((info, index) => info && [info, gitDirs[index]])
                .filter(a => a)
                //@ts-ignore
                .reduce((obj, [{ owner, name }, dirName]: [Record<"owner" | "name", string>, string]) => {
                    if (!obj[owner]) obj[owner] = {}
                    obj[owner][dirName] = name
                    return obj
                }, {} as Groups) as unknown as Groups

            return <>
                <Text color="blueBright">Info about {dirsInfo.filter(a => a !== null).length} remote repos</Text>
                {
                    Object.entries(groupedRepos)
                        .map(([owner, repos]) => {
                            return <React.Fragment key={owner}>
                                <Text color="green">Owner: <Text bold>{owner}</Text> {Object.keys(repos).length}</Text>
                                {
                                    Object.entries(repos)
                                        .map(([dir, repo]) => {
                                            return <Text key={dir}><Text bold>{repo}</Text> – {dir}</Text>
                                        })
                                }
                            </React.Fragment>
                        })
                }
            </>
        }
    },
    "rename-repos": {
        label: "Rename repos",
        getOutput: async ({ conrimActionCallback, setTempOutput }: GetOutputProps) => {
            // todo allow custom templates
            const repoNameTemplate = "%owner%_%repo%"
            const { git: gitDirs } = await getDirsFromCwd(cwd)

            const dirsInfo = await Promise.all(
                gitDirs.map(dir => {
                    const repoPath = path.join(cwd, dir)
                    return getGithubRemoteInfo(repoPath)
                })
            )

            // destination dir name - original dir name
            const dirsNameMap = new Map<string, string>()
            // source dir name - expected dir name
            const nonObviousRenames = new Map<string, string>()

            dirsInfo.forEach((dirInfo, index) => {
                if (!dirInfo) return
                const { owner, name } = dirInfo
                const sourceDirName = gitDirs[index]
                const destDirName = repoNameTemplate
                    .replace("%owner%", owner)
                    .replace("%repo%", name)
                const duplicatedDir = dirsNameMap.get(destDirName)
                // todo-high review errors UI in production
                if (duplicatedDir) throw new TypeError(`There is a conflict with ${duplicatedDir} and ${sourceDirName}. They're both have the same owner / repo (${destDirName}). Please, resolve it manually`)
                dirsNameMap.set(destDirName, sourceDirName)
                // assumed that has default git tools, that use name from remote path
                if (sourceDirName !== name) nonObviousRenames.set(sourceDirName, name)
            })

            setTempOutput(<>
                <Text>There're {dirsNameMap.size} dirs that going to be renamed. Ex: repo-name → owner_repo-name</Text>
                {nonObviousRenames.size &&
                    <>
                        <Text color="red">Watch out! There are non obvious renames, these folder will lose their custom names:</Text>
                        <InkTable data={Array.from(nonObviousRenames.entries()).map(([source, expected]) => ({ actual: source, expected }))} />
                    </>
                }
            </>)

            await conrimActionCallback()

            setTempOutput(null)

            await Promise.all(
                Array.from(dirsNameMap.entries()).map(([distDir, sourceDir]) => {
                    const rename = async () => {
                        const sourcePath = path.join(cwd, sourceDir)
                        const distPath = path.join(cwd, distDir)
                        await fs.promises.rename(sourcePath, distPath)
                    }
                    return rename()
                })
            )
            return <Text color="greenBright">All directories were successfully renamed</Text>
            // return <InkTable data={Array.from(dirsNameMap.entries()).map(([dist, src]) => ({ src, dist }))} />
        }
    },
    "non-git-dirs": {
        label: "Show non-git directories",
        getOutput: async () => {
            const nonGitDirs = (await getDirsFromCwd(cwd)).nonGit

            return <Text color="blueBright">There are {nonGitDirs.length} non-git dirs: {nonGitDirs.join(", ")}</Text>
        }
    },
    "non-remote-repos": {
        label: "Show non remote repos",
        getOutput: async () => {
            const gitDirs = (await getDirsFromCwd(cwd)).git

            const nonRemoteFlags = await Promise.all(
                gitDirs.map(dir => {
                    const repoPath = path.join(cwd, dir)
                    return (async () => await getGithubRemoteInfo(repoPath) === null)()
                })
            )

            const nonRemoteDirs = filterWith(gitDirs, nonRemoteFlags, a => a)

            return <Text color="blueBright">There are {nonRemoteDirs.length} non-remote dirs: {nonRemoteDirs.join(", ")}</Text>
        }
    },
    // "normalize-origin-url": {

    // }
} as const

const NoScript: FC = () => {
    const [selectedScript, setSelectedScript] = React.useState(null as string | null)

    const onSelect = useCallback(({ value }) => setSelectedScript(value), [])

    return !selectedScript ? <>
        <Text>Select script to run:</Text>
        <SelectInput items={Object.entries(scripts).map(([value, { label }]) => ({ label: `${label} – ${value}`, value }))} onSelect={onSelect} />
    </> : <RunScript script={selectedScript} />
}

const RunScript: FC<{ script: string }> = ({ script: scriptName }) => {
    const [output, setOutput] = React.useState(null as JSX.Element | null)
    const [confirmCallback, setConfirmCallback] = useState(false)
    const confirmCallbackRef = useRef(null! as () => void)
    const [tempOutput, setTempOutput] = useState<JSX.Element | null>(null)

    useEffect(() => {
        const script = scripts[scriptName]
        if ("getOutput" in script) {
            script.getOutput({
                conrimActionCallback: () => {
                    return new Promise<void>(resolve => { setConfirmCallback(true); confirmCallbackRef.current = resolve })
                },
                setTempOutput
            } as GetOutputProps).then(output => setOutput(output))
        } else {
            throw new Error(`Script has no runner`)
        }
    }, [])

    return <>
        <Text color="cyan">Running script: <Text bold>{scriptName}</Text></Text>
        {tempOutput}
        {
            confirmCallback ? <PauseScript onConfirm={() => {
                confirmCallbackRef.current(); setConfirmCallback(false)
            }} /> : output || <InkSpinner />
        }
    </>
}

const scriptArg = program.args[0]

render(scriptArg ? <RunScript script={scriptArg} /> : <NoScript />)