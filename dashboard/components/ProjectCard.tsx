'use client';

import { ProjectInfo } from '@/types';
import { Building2, Users, ExternalLink, CheckCircle2, AlertCircle, FileCheck } from 'lucide-react';

interface ProjectCardProps {
  project: ProjectInfo;
}

export default function ProjectCard({ project }: ProjectCardProps) {
  const statusColor = project.status === 'verified' ? 'text-green-600' : 'text-yellow-600';
  const StatusIcon = project.status === 'verified' ? CheckCircle2 : AlertCircle;

  return (
    <div className="bg-gray-900 rounded-lg border border-gray-800 p-6">
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <Building2 className="w-8 h-8 text-blue-600" />
          <div>
            <h2 className="text-2xl font-bold text-white">
              {project.companyName}
            </h2>
            <p className="text-sm text-gray-400">
              {project.legalEntityName}
            </p>
          </div>
        </div>
        <div className={`flex items-center gap-2 ${statusColor}`}>
          <StatusIcon className="w-5 h-5" />
          <span className="text-sm font-semibold uppercase">{project.status}</span>
        </div>
      </div>

      {project.description && (
        <p className="text-gray-300 mb-4">
          {project.description}
        </p>
      )}

      <div className="space-y-3">
        <div className="flex items-center gap-2 text-sm">
          <Users className="w-4 h-4 text-gray-500" />
          <span className="text-gray-400">Owners:</span>
          <span className="text-white font-medium">
            {project.owners.join(', ')}
          </span>
        </div>

        <div className="flex items-center gap-2 text-sm">
          <span className="text-gray-400">Operator Account:</span>
          <code className="text-xs bg-gray-800 px-2 py-1 rounded">
            {project.operatorAccountId}
          </code>
        </div>

        {project.publicRecordUrl && (
          <a
            href={project.publicRecordUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 text-sm text-blue-400 hover:text-blue-300"
          >
            <ExternalLink className="w-4 h-4" />
            View Public Records
          </a>
        )}
      </div>

      {project.audits && project.audits.length > 0 && (
        <div className="mt-4 pt-4 border-t border-gray-800">
          <div className="flex items-center gap-2 mb-3">
            <FileCheck className="w-5 h-5 text-green-500" />
            <h3 className="font-semibold text-white">Contract Audits</h3>
          </div>
          <div className="space-y-3">
            {project.audits.map((audit, idx) => {
              const statusColors = {
                passed: 'bg-green-600',
                warning: 'bg-yellow-600',
                pending: 'bg-blue-600',
                failed: 'bg-red-600'
              };
              const bgColors = {
                passed: 'bg-green-900/20 border-green-800',
                warning: 'bg-yellow-900/20 border-yellow-800',
                pending: 'bg-blue-900/20 border-blue-800',
                failed: 'bg-red-900/20 border-red-800'
              };
              
              return (
                <div key={idx} className={`${bgColors[audit.status]} border rounded-lg p-4`}>
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-bold text-white">
                          {audit.contractName}
                        </span>
                        <span className={`text-xs font-semibold ${statusColors[audit.status]} text-white px-2 py-0.5 rounded uppercase`}>
                          {audit.status}
                        </span>
                        {audit.score !== undefined && (
                          <span className="text-xs font-semibold bg-gray-700 text-white px-2 py-0.5 rounded">
                            Score: {audit.score}
                          </span>
                        )}
                      </div>
                      {audit.contractAddress && (
                        <code className="text-xs text-gray-400">
                          {audit.contractAddress}
                        </code>
                      )}
                    </div>
                  </div>
                  
                  <div className="text-xs text-gray-400 mb-2">
                    <span className="font-medium">Audited by:</span> {audit.auditor}
                    {audit.auditDate && (
                      <span className="ml-2">• {new Date(audit.auditDate).toLocaleDateString()}</span>
                    )}
                  </div>
                  
                  {audit.findings && audit.findings.length > 0 && (
                    <div className="mt-2">
                      <div className="text-xs font-medium text-gray-300 mb-1">Findings:</div>
                      <ul className="space-y-1">
                        {audit.findings.map((finding, fIdx) => (
                          <li key={fIdx} className="text-xs text-gray-300">
                            {finding}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  
                  {audit.reportUrl && (
                    <a
                      href={audit.reportUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 mt-2"
                    >
                      <ExternalLink className="w-3 h-3" />
                      View Contract Source
                    </a>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

