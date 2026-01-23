import { GitLabComment } from '../types';
import {
  REGEX_MR_URL_PATTERN_1,
  REGEX_MR_URL_PATTERN_2,
  DEFAULT_COMMENTS_PER_PAGE,
} from '../constants';

/**
 * GitLab API 服务
 * 用于获取 MR 相关信息
 */
export class GitLabService {
  private baseUrl: string;
  private token: string;

  constructor(baseUrl: string, token: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.token = token;
  }

  /**
   * 解析 MR URL 获取 project ID 和 MR IID
   * @param mrUrl - GitLab MR URL
   * @returns 解析后的 projectId 和 mrIid，或 null
   */
  parseMRUrl(mrUrl: string): { projectId: string; mrIid: number } | null {
    const patterns = [REGEX_MR_URL_PATTERN_1, REGEX_MR_URL_PATTERN_2];

    for (const pattern of patterns) {
      const match = mrUrl.match(pattern);
      if (match) {
        return {
          projectId: match[1],
          mrIid: parseInt(match[2], 10),
        };
      }
    }
    return null;
  }

  /**
   * 获取 MR 的所有 comments/notes
   * @param projectId 项目 ID（可以是 namespace/project 格式）
   * @param mrIid MR 的 IID
   * @param perPage - 每页数量
   */
  async getMRComments(
    projectId: string,
    mrIid: number,
    perPage: number = DEFAULT_COMMENTS_PER_PAGE
  ): Promise<GitLabComment[]> {
    const encodedProjectId = encodeURIComponent(projectId);
    const url = `${this.baseUrl}/api/v4/projects/${encodedProjectId}/merge_requests/${mrIid}/notes?per_page=${perPage}&sort=desc`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'PRIVATE-TOKEN': this.token,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(
        `Failed to fetch MR comments: ${response.status} ${response.statusText}`
      );
    }

    return response.json() as Promise<GitLabComment[]>;
  }

  /**
   * 获取 MR 基本信息
   */
  async getMRInfo(projectId: string, mrIid: number): Promise<any> {
    const encodedProjectId = encodeURIComponent(projectId);
    const url = `${this.baseUrl}/api/v4/projects/${encodedProjectId}/merge_requests/${mrIid}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'PRIVATE-TOKEN': this.token,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(
        `Failed to fetch MR info: ${response.status} ${response.statusText}`
      );
    }

    return response.json();
  }

  /**
   * 从 MR URL 直接获取 comments
   */
  async getCommentsFromMRUrl(mrUrl: string): Promise<GitLabComment[]> {
    const parsed = this.parseMRUrl(mrUrl);
    if (!parsed) {
      throw new Error(`Invalid MR URL: ${mrUrl}`);
    }
    return this.getMRComments(parsed.projectId, parsed.mrIid);
  }
}

export default GitLabService;

