import { useState } from 'react'

interface FunctionSignatureProps {
  name: string
  params: { name: string; type: string; description: string }[]
}

export function FunctionSignature({ name, params }: FunctionSignatureProps) {
  const [hoveredParam, setHoveredParam] = useState<string | null>(null)

  // Parse function name and parameters
  const functionName = name.split('(')[0]
  const paramsString = name.match(/\((.*)\)/)?.[1] || ''
  const paramNames = paramsString.split(',').map(p => p.trim()).filter(Boolean)

  return (
    <h1 className="text-3xl font-semibold mb-2 font-mono">
      <span className="text-blue-600 dark:text-blue-400">{functionName}</span>
      <span className="text-gray-600 dark:text-gray-400">(</span>
      {paramNames.map((paramName, index) => {
        const param = params.find(p => p.name === paramName)
        return (
          <span key={paramName} className="relative inline-block">
            <span
              onMouseEnter={() => setHoveredParam(paramName)}
              onMouseLeave={() => setHoveredParam(null)}
              className="cursor-help hover:bg-blue-50 dark:hover:bg-blue-900/20 px-1 rounded transition-colors text-orange-600 dark:text-orange-400"
            >
              {paramName}
            </span>
            {hoveredParam === paramName && param && (
              <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 text-sm bg-gray-900 dark:bg-gray-800 text-white rounded-lg whitespace-nowrap z-10 shadow-lg border border-gray-700">
                <span className="font-semibold">{param.type}</span>: {param.description}
                <span className="absolute top-full left-1/2 -translate-x-1/2 -mt-1 border-4 border-transparent border-t-gray-900 dark:border-t-gray-800"></span>
              </span>
            )}
            {index < paramNames.length - 1 && (
              <span className="text-gray-600 dark:text-gray-400">, </span>
            )}
          </span>
        )
      })}
      <span className="text-gray-600 dark:text-gray-400">)</span>
    </h1>
  )
}
