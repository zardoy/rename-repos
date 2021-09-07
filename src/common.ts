import fs from 'fs'
import remoteOrigin from 'git-remote-origin-url'
import path from 'path'

import { graphql } from '@octokit/graphql/dist-types/types'

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

export const getGithubRemoteInfo = async (repoRootPath: string): Promise<Record<'owner' | 'name', string> | null> => {
    let originUrl: null | string = null
    try {
        try {
            originUrl = await remoteOrigin(repoRootPath)
        } catch (err) {
            if (err.message.startsWith("Couldn't find")) originUrl = null
            else throw err
        }
        if (!originUrl) return null

        const gitMatch = originUrl.match(/git@github.com:(?<owner>\w+)\/(?<name>.+)(.git)/)
        if (gitMatch) {
            return gitMatch.groups! as any
        }

        const url = new URL(originUrl)
        if (url.hostname !== 'github.com') throw new Error(`Unknown host ${url.hostname}`)
        let [, owner, name] = url.pathname.split('/')
        if (name.endsWith('.git')) name = name.slice(0, -'.git'.length)

        return { owner, name }
    } catch (err) {
        throw new Error(`${err.message} Error occured in ${repoRootPath} with remote origin ${originUrl}`)
    }
}

const gql = String.raw

type Return = { moved: false } | { moved: true; newSlug: string }

const getIsRepoMoved = async (graphqlWithAuth: graphql, slugs: `${string}/${string}`[]): Promise<Return[]> => {
    const requestBody = slugs.map((slug, index) => {
        const [owner, name] = slug.split('/')
        // yes, no variables
        return `
                r${index}: repository(owner: "${owner}", name: "${name}") {
                    nameWithOwner
                }`
    })

    const reposData: any = await graphqlWithAuth(`
        {
            ${requestBody}
        }
    `)
    return slugs.map((slug, index): Return => {
        const responseSlug: string = reposData[`r${index}`].nameWithOwner
        if (responseSlug === slug) {
            return { moved: false }
        } else {
            return { moved: true, newSlug: responseSlug }
        }
    })
}
