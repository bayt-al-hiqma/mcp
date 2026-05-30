/**
 * GitHub-based vault backend for durable Markdown storage
 */

import { Octokit } from '@octokit/rest';
import { Config } from '../types/index.js';
import { validateVaultPath, ensureMarkdownExtension } from './path-safety.js';

export class GitHubVault {
  private octokit: Octokit;
  private config: Config;

  constructor(config: Config) {
    this.config = config;
    this.octokit = new Octokit({
      auth: config.githubToken
    });
  }

  /**
   * Read a file from the vault
   */
  async readFile(path: string): Promise<string> {
    const safePath = validateVaultPath(path, this.config.vaultRoot);
    const fullPath = this.config.vaultRoot
      ? `${this.config.vaultRoot}/${safePath}`
      : safePath;

    try {
      const { data } = await this.octokit.repos.getContent({
        owner: this.config.vaultOwner,
        repo: this.config.vaultRepo,
        path: fullPath,
        ref: this.config.vaultBranch
      });

      if ('content' in data && data.type === 'file') {
        return Buffer.from(data.content, 'base64').toString('utf-8');
      }

      throw new Error(`Path is not a file: ${path}`);
    } catch (error: any) {
      if (error.status === 404) {
        throw new Error(`File not found: ${path}`);
      }
      throw error;
    }
  }

  /**
   * Write a file to the vault
   */
  async writeFile(
    path: string,
    content: string,
    message: string,
    sha?: string
  ): Promise<void> {
    const safePath = validateVaultPath(path, this.config.vaultRoot);
    const fullPath = this.config.vaultRoot
      ? `${this.config.vaultRoot}/${safePath}`
      : safePath;

    const encodedContent = Buffer.from(content, 'utf-8').toString('base64');

    await this.octokit.repos.createOrUpdateFileContents({
      owner: this.config.vaultOwner,
      repo: this.config.vaultRepo,
      path: fullPath,
      message,
      content: encodedContent,
      branch: this.config.vaultBranch,
      ...(sha && { sha })
    });
  }

  /**
   * Check if a file exists and get its SHA
   */
  async getFileSha(path: string): Promise<string | null> {
    const safePath = validateVaultPath(path, this.config.vaultRoot);
    const fullPath = this.config.vaultRoot
      ? `${this.config.vaultRoot}/${safePath}`
      : safePath;

    try {
      const { data } = await this.octokit.repos.getContent({
        owner: this.config.vaultOwner,
        repo: this.config.vaultRepo,
        path: fullPath,
        ref: this.config.vaultBranch
      });

      if ('sha' in data && data.type === 'file') {
        return data.sha;
      }

      return null;
    } catch (error: any) {
      if (error.status === 404) {
        return null;
      }
      throw error;
    }
  }

  /**
   * List all files in a directory
   */
  async listFiles(dirPath: string = ''): Promise<string[]> {
    const safePath = dirPath ? validateVaultPath(dirPath, this.config.vaultRoot) : '';
    const fullPath = this.config.vaultRoot
      ? (safePath ? `${this.config.vaultRoot}/${safePath}` : this.config.vaultRoot)
      : safePath;

    try {
      const files: string[] = [];
      await this.listFilesRecursive(fullPath, files);
      return files;
    } catch (error: any) {
      if (error.status === 404) {
        return [];
      }
      throw error;
    }
  }

  /**
   * Recursively list all markdown files
   */
  private async listFilesRecursive(path: string, files: string[]): Promise<void> {
    const { data } = await this.octokit.repos.getContent({
      owner: this.config.vaultOwner,
      repo: this.config.vaultRepo,
      path: path || undefined,
      ref: this.config.vaultBranch
    });

    if (!Array.isArray(data)) {
      return;
    }

    for (const item of data) {
      if (item.type === 'file' && item.path.endsWith('.md')) {
        // Remove vault root prefix if present
        let relativePath = item.path;
        if (this.config.vaultRoot && relativePath.startsWith(this.config.vaultRoot + '/')) {
          relativePath = relativePath.slice(this.config.vaultRoot.length + 1);
        }
        files.push(relativePath);
      } else if (item.type === 'dir') {
        await this.listFilesRecursive(item.path, files);
      }
    }
  }

  /**
   * Get recently modified files
   */
  async getRecentlyModified(limit: number = 10): Promise<Array<{ path: string; date: Date }>> {
    try {
      const { data: commits } = await this.octokit.repos.listCommits({
        owner: this.config.vaultOwner,
        repo: this.config.vaultRepo,
        sha: this.config.vaultBranch,
        per_page: Math.min(limit * 3, 100) // Get more commits to find file changes
      });

      const fileChanges = new Map<string, Date>();

      for (const commit of commits) {
        const { data: commitData } = await this.octokit.repos.getCommit({
          owner: this.config.vaultOwner,
          repo: this.config.vaultRepo,
          ref: commit.sha
        });

        for (const file of commitData.files || []) {
          if (file.filename.endsWith('.md') && !fileChanges.has(file.filename)) {
            let relativePath = file.filename;
            if (this.config.vaultRoot && relativePath.startsWith(this.config.vaultRoot + '/')) {
              relativePath = relativePath.slice(this.config.vaultRoot.length + 1);
            }
            fileChanges.set(relativePath, new Date(commit.commit.author?.date || Date.now()));
          }

          if (fileChanges.size >= limit) {
            break;
          }
        }

        if (fileChanges.size >= limit) {
          break;
        }
      }

      return Array.from(fileChanges.entries())
        .map(([path, date]) => ({ path, date }))
        .slice(0, limit);
    } catch (error) {
      console.error('Error fetching recent changes:', error);
      return [];
    }
  }

  /**
   * Check vault accessibility
   */
  async checkHealth(): Promise<{ accessible: boolean; error?: string }> {
    try {
      await this.octokit.repos.get({
        owner: this.config.vaultOwner,
        repo: this.config.vaultRepo
      });
      return { accessible: true };
    } catch (error: any) {
      return {
        accessible: false,
        error: error.message || 'Cannot access vault'
      };
    }
  }
}
