import fs from 'fs'
import ini from 'ini'
import { render, Text } from 'ink'
import SelectInput from 'ink-select-input'
import InkSpinner from 'ink-spinner'
import InkTable from 'ink-table'
import path, { join } from 'path'
import React, { FC, useCallback, useEffect, useRef, useState } from 'react'
import readPackageUp from 'read-pkg-up'
import { fromSlug, getDirsFromCwd, getIsRepoMoved, remoteFromDirs, toSlug } from './git'
import PauseScript from './pause-script'
import { filterWith } from './util'
import minimist from 'minimist'
import { getGithubRemoteInfo, RepoInfo } from 'github-remote-info'
import { graphql } from '@octokit/graphql'

// thats how CLI should look like (from UX point of view, not DX)

// program.version(readPackageUp.sync()!.packageJson.version)

// program
//     .option('-d, --dir <path>', 'Working directory for scripts', process.cwd())
//     .argument('[script]', 'run without this argument to see possible script names')

// todo-low (needs testing) add link for dirs support

// program.parse()

// const cwd: string = program.opts().dir
const args = minimist(process.argv.slice(2))

if (args.cwd) process.chdir(path.join(process.cwd(), args.cwd))

const cwd = process.cwd()

interface GetOutputProps {
    conrimActionCallback: () => Promise<void>
    setTempOutput: (component: JSX.Element | null) => void
}

interface Command {
    label: string
    getOutput: (helpers: GetOutputProps, parsedFlags: Record<string, any>) => Promise<JSX.Element>
}
const makeCommands = <T extends string>(commands: Record<T, Command>) => commands

const commands = makeCommands({
    'all-remote-repos': {
        label: 'Show GitHub info for all repos (offline, extracts origin)',
        getOutput: async () => {
            const { git: gitDirs } = await getDirsFromCwd(cwd)
            const dirsInfo = await remoteFromDirs(gitDirs)

            type RepoSlug = string
            type Groups = {
                [user: string]: {
                    [dir: string]: RepoSlug
                }
            }

            const groupedRepos = dirsInfo
                .map((info, index) => (info && [info, gitDirs[index]]) as [RepoInfo, string])
                .filter(a => a)
                .reduce((obj, [{ owner, name }, dirName]) => {
                    if (!obj[owner]) obj[owner] = {}
                    obj[owner][dirName] = name
                    return obj
                }, {} as Groups)

            return (
                <>
                    <Text color="blueBright">Info about {dirsInfo.filter(a => a !== null).length} remote repos</Text>
                    {Object.entries(groupedRepos).map(([owner, repos]) => {
                        return (
                            <React.Fragment key={owner}>
                                <Text color="green">
                                    Owner: <Text bold>{owner}</Text> {Object.keys(repos).length}
                                </Text>
                                {Object.entries(repos).map(([dir, repo]) => {
                                    return (
                                        <Text key={dir}>
                                            <Text bold>{repo}</Text> – {dir}
                                        </Text>
                                    )
                                })}
                            </React.Fragment>
                        )
                    })}
                </>
            )
        },
    },
    'rename-repos': {
        label: 'Rename repos',
        getOutput: async ({ conrimActionCallback, setTempOutput }, { repoNameTemplate = '%owner%_%repo%' }) => {
            const { git: gitDirs } = await getDirsFromCwd(cwd)
            const dirsInfo = await remoteFromDirs(gitDirs)

            // destination dir name - original dir name
            const dirsNameMap = new Map<string, string>()
            // source dir name - expected dir name
            const nonObviousRenames = new Map<string, string>()

            dirsInfo.forEach((dirInfo, index) => {
                if (!dirInfo) return
                const { owner, name } = dirInfo
                const sourceDirName = gitDirs[index]
                const destDirName = repoNameTemplate.replace('%owner%', owner).replace('%repo%', name)
                const duplicatedDir = dirsNameMap.get(destDirName)
                // todo-high review errors UI in production
                if (duplicatedDir)
                    throw new TypeError(
                        `There is a conflict with ${duplicatedDir} and ${sourceDirName}. They're both have the same owner / repo (${destDirName}). Please, resolve it manually`,
                    )
                dirsNameMap.set(destDirName, sourceDirName)
                // assumed that has default git tools, that use name from remote path
                if (sourceDirName !== name) nonObviousRenames.set(sourceDirName, name)
            })

            setTempOutput(
                <>
                    <Text>There're {dirsNameMap.size} dirs that going to be renamed. Ex: repo-name → owner_repo-name</Text>
                    {nonObviousRenames.size && (
                        <>
                            <Text color="red">Watch out! There are non obvious renames, these folder will lose their custom names:</Text>
                            <InkTable data={Array.from(nonObviousRenames.entries()).map(([source, expected]) => ({ actual: source, expected }))} />
                        </>
                    )}
                </>,
            )

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
                }),
            )
            return <Text color="greenBright">All directories were successfully renamed</Text>
            // return <InkTable data={Array.from(dirsNameMap.entries()).map(([dist, src]) => ({ src, dist }))} />
        },
    },
    'non-git-dirs': {
        label: 'Show non-git directories',
        getOutput: async () => {
            const nonGitDirs = (await getDirsFromCwd(cwd)).nonGit

            return (
                <Text color="blueBright">
                    There are {nonGitDirs.length} non-git dirs: {nonGitDirs.join(', ')}
                </Text>
            )
        },
    },
    'non-remote-repos': {
        label: 'Show non remote repos',
        getOutput: async () => {
            const { git: gitDirs } = await getDirsFromCwd(cwd)

            const nonRemoteFlags = await Promise.all(
                gitDirs.map(dir => {
                    const repoPath = path.join(cwd, dir)
                    return (async () => (await getGithubRemoteInfo(repoPath)) === null)()
                }),
            )

            const nonRemoteDirs = filterWith(gitDirs, nonRemoteFlags, a => a)

            return (
                <Text color="blueBright">
                    There are {nonRemoteDirs.length} non-remote dirs: {nonRemoteDirs.join(', ')}
                </Text>
            )
        },
    },
    // flags: --personalToken <string> optional: --updatePackageJson=false --no-preview
    'upgrade-name-from-github': {
        label: 'Fetch current repos owner/name from GitHub API using your personal token',
        async getOutput({ conrimActionCallback, setTempOutput }, { personalToken, preview = true, updatePackageJson }) {
            // PUPJR = Possible Update of Package.Json's Repository
            if (!personalToken) throw new TypeError('--personalToken flag is required')
            const { git: gitDirs } = await getDirsFromCwd(cwd)
            // TODO fix ! type
            const repos = (await remoteFromDirs(gitDirs)).map((info, index) => (info ? { dir: gitDirs[index], info } : undefined!)).filter(a => a)

            const gql = graphql.defaults({
                headers: {
                    authorization: `token ${personalToken}`,
                },
            })

            const newRepoInfo = await getIsRepoMoved(
                gql,
                repos.map(r => r.info),
            )
            const movedRepos = newRepoInfo
                .map((repo, index) =>
                    repo && repo.moved === true
                        ? {
                              oldSlug: toSlug(repos[index].info),
                              dir: repos[index].dir,
                              newSlug: repo.newSlug,
                          }
                        : undefined!,
                )
                .filter(a => a)

            setTempOutput(
                <>
                    {/* TODO use pick */}
                    <InkTable data={movedRepos.map(({ oldSlug, newSlug }) => ({ oldSlug, newSlug }))} />
                    <Text>This will just replace origin url</Text>
                </>,
            )

            await conrimActionCallback()

            for (const repo of movedRepos) {
                const gitConfigPath = join(process.cwd(), repo.dir, '.git/config')
                const configParsed = ini.decode(await fs.promises.readFile(gitConfigPath, 'utf-8'))

                if (configParsed['remote "origin"'].url.startsWith('ssh:')) throw new Error('ssh protocol is not supported')

                const { newSlug } = repo
                const [oldParsedSlug, newParsedSlug] = [fromSlug(repo.oldSlug), fromSlug(newSlug)]
                configParsed['remote "origin"'].url = `https://github.com/${newSlug}.git`

                await fs.promises.writeFile(gitConfigPath, ini.encode(configParsed), 'utf-8')

                let newName: string | undefined
                if (repo.dir === oldParsedSlug.name) {
                    newName = newParsedSlug.name
                } else if (repo.dir === `${oldParsedSlug.owner}_${oldParsedSlug.name}`) {
                    // TODO support custom templates
                    newName = `${newParsedSlug.owner}_${newParsedSlug.name}`
                }
                if (newName) await fs.promises.rename(join(process.cwd(), repo.dir), join(process.cwd(), newName))
            }

            return <Text>Done with {movedRepos.length} repos</Text>
        },
    },
})

const NoScript: FC = () => {
    const [selectedScript, setSelectedScript] = React.useState(null as string | null)

    const onSelect = useCallback(({ value }) => setSelectedScript(value), [])

    return !selectedScript ? (
        <>
            <Text>Select script to run:</Text>
            <SelectInput
                items={Object.entries(commands).map(([value, { label }]) => ({ label: `${label} – ${value}`, value }))}
                onSelect={onSelect}
            />
        </>
    ) : (
        <RunScript script={selectedScript} />
    )
}

const RunScript: FC<{ script: string }> = ({ script: scriptName }) => {
    const [output, setOutput] = React.useState(null as JSX.Element | null)
    const [confirmCallback, setConfirmCallback] = useState(false)
    const confirmCallbackRef = useRef(null! as () => void)
    const [tempOutput, setTempOutput] = useState<JSX.Element | null>(null)

    useEffect(() => {
        const script: Command = commands[scriptName]
        if ('getOutput' in script) {
            script
                .getOutput(
                    {
                        conrimActionCallback() {
                            return new Promise<void>(resolve => {
                                setConfirmCallback(true)
                                confirmCallbackRef.current = resolve
                            })
                        },
                        setTempOutput,
                    },
                    args,
                )
                .then(output => setOutput(output))
        } else {
            throw new Error(`Script has no runner`)
        }
    }, [])

    return (
        <>
            <Text color="cyan">
                Running script: <Text bold>{scriptName}</Text>
            </Text>
            {tempOutput}
            {confirmCallback ? (
                <PauseScript
                    onConfirm={() => {
                        confirmCallbackRef.current()
                        setConfirmCallback(false)
                    }}
                />
            ) : (
                output || <InkSpinner />
            )}
        </>
    )
}

render(args._?.length ? <RunScript script={args._[0]} /> : <NoScript />)
