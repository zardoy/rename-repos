import fs from 'fs'
import path from 'path'

import { graphql } from '@octokit/graphql/dist-types/types'
import { getGithubRemoteInfo, RepoInfo } from 'github-remote-info'

export const toSlug = ({ owner, name }: RepoInfo) => `${owner}/${name}`

export const fromSlug = (slug: string): RepoInfo => {
    const [owner, name] = slug.split('/')
    return { owner, name }
}

export const getDirsFromCwd = async (cwd: string) => {
    const dirs: Record<'git' | 'nonGit', string[]> = { git: [], nonGit: [] }
    const dirsList = await fs.promises.readdir(cwd)
    for (const dirName of dirsList) {
        if (!fs.lstatSync(path.join(cwd, dirName)).isDirectory()) continue
        const gitPath = path.join(cwd, dirName, '.git')
        const isGitDir = fs.existsSync(gitPath) && fs.lstatSync(gitPath).isDirectory()
        ;(isGitDir ? dirs['git'] : dirs['nonGit']).push(dirName)
    }
    return dirs
}

export const remoteFromDirs = async (gitDirs: string[]) => {
    return await Promise.all(
        gitDirs.map(dir => {
            const repoPath = path.join(process.cwd(), dir)
            return getGithubRemoteInfo(repoPath).catch(error => {
                console.warn('[warning] Skipped repo:', error)
            })
        }),
    )
}

const gql = String.raw

type NewRepoInfo = { moved: false } | { moved: true; newSlug: string } | null

export const getIsRepoMoved = async (graphqlWithAuth: graphql, repos: RepoInfo[]): Promise<NewRepoInfo[]> => {
    const requestBody = repos
        .map(({ owner, name }, index) => {
            // TODO skip don't throw
            // TODO find more safe and elegant way to defense against injection
            if (name.includes('"') || owner.includes('"')) throw new TypeError('" can\'t be in origin')
            // TODO reconsider adding variables. I don't do it to not bloat the query
            return `
                r${index}: repository(owner: "${owner}", name: "${name}") {
                    nameWithOwner
                }`
        })
        .join('\n')

    let responseData
    try {
        responseData = await graphqlWithAuth(`
        {
            ${requestBody}
        }
        `)
    } catch (err) {
        if (!err.data) throw err
        responseData = err.data
    }
    return repos.map((repo, index): NewRepoInfo => {
        const responseSlug: string | undefined = responseData[`r${index}`]?.nameWithOwner
        if (!responseSlug) return null
        if (responseSlug === toSlug(repo)) {
            return { moved: false }
        } else {
            return { moved: true, newSlug: responseSlug }
        }
    })
}
