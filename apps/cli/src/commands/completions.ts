/**
 * skillset completions command
 */

import chalk from "chalk";
import type { Command } from "commander";

type ShellType = "bash" | "zsh" | "fish" | "powershell";

/**
 * Generate bash completions
 */
function generateBashCompletions(): string {
  return `# skillset bash completion
_skillset_completions() {
  local cur=\${COMP_WORDS[COMP_CWORD]}
  local cmd=\${COMP_WORDS[1]}

  if [[ $COMP_CWORD == 1 ]]; then
    COMPREPLY=($(compgen -W "list show load sync alias unalias config doctor index init completions" -- $cur))
  elif [[ $cmd == "show" || $cmd == "load" ]]; then
    # Complete with skill names from cache
    COMPREPLY=($(compgen -W "$(skillset list --raw 2>/dev/null)" -- $cur))
  elif [[ $cmd == "completions" ]]; then
    COMPREPLY=($(compgen -W "bash zsh fish powershell" -- $cur))
  elif [[ $cmd == "config" ]]; then
    COMPREPLY=($(compgen -W "get set" -- $cur))
  fi
}
complete -F _skillset_completions skillset
`;
}

/**
 * Generate zsh completions
 */
function generateZshCompletions(): string {
  return `#compdef skillset

_skillset() {
  local -a commands
  commands=(
    'list:List all skills and sets'
    'show:Show skill metadata'
    'load:Load and output skill content'
    'sync:Sync skills to configured targets'
    'alias:Add or update a skill alias'
    'unalias:Remove a skill alias'
    'config:Manage skillset configuration'
    'doctor:Check skillset installation and configuration'
    'index:Scan for SKILL.md files and refresh cache'
    'init:Scaffold config files with sensible defaults'
    'completions:Generate shell completions'
  )

  if (( CURRENT == 2 )); then
    _describe 'command' commands
  else
    case "\${words[2]}" in
      show|load)
        _values 'skills' $(skillset list --raw 2>/dev/null)
        ;;
      completions)
        _values 'shell' bash zsh fish powershell
        ;;
      config)
        _values 'subcommand' get set
        ;;
    esac
  fi
}

_skillset
`;
}

/**
 * Generate fish completions
 */
function generateFishCompletions(): string {
  return `# skillset fish completion

# Main commands
complete -c skillset -f -n "__fish_use_subcommand" -a "list" -d "List all skills and sets"
complete -c skillset -f -n "__fish_use_subcommand" -a "show" -d "Show skill metadata"
complete -c skillset -f -n "__fish_use_subcommand" -a "load" -d "Load and output skill content"
complete -c skillset -f -n "__fish_use_subcommand" -a "sync" -d "Sync skills to configured targets"
complete -c skillset -f -n "__fish_use_subcommand" -a "alias" -d "Add or update a skill alias"
complete -c skillset -f -n "__fish_use_subcommand" -a "unalias" -d "Remove a skill alias"
complete -c skillset -f -n "__fish_use_subcommand" -a "config" -d "Manage skillset configuration"
complete -c skillset -f -n "__fish_use_subcommand" -a "doctor" -d "Check skillset installation and configuration"
complete -c skillset -f -n "__fish_use_subcommand" -a "index" -d "Scan for SKILL.md files and refresh cache"
complete -c skillset -f -n "__fish_use_subcommand" -a "init" -d "Scaffold config files with sensible defaults"
complete -c skillset -f -n "__fish_use_subcommand" -a "completions" -d "Generate shell completions"

# Global flags
complete -c skillset -l json -d "JSON output"
complete -c skillset -l raw -d "Raw output for piping"
complete -c skillset -s q -l quiet -d "Suppress non-essential output"
complete -c skillset -s v -l verbose -d "Extra detail"
complete -c skillset -s s -l source -d "Filter by source namespace"
complete -c skillset -l kind -d "Disambiguate skill vs set"

# Completions subcommand
complete -c skillset -f -n "__fish_seen_subcommand_from completions" -a "bash zsh fish powershell"

# Config subcommand
complete -c skillset -f -n "__fish_seen_subcommand_from config" -a "get set"
`;
}

/**
 * Generate PowerShell completions
 */
function generatePowerShellCompletions(): string {
  return `# skillset PowerShell completion

Register-ArgumentCompleter -Native -CommandName skillset -ScriptBlock {
    param($wordToComplete, $commandAst, $cursorPosition)

    $commands = @(
        'list',
        'show',
        'load',
        'sync',
        'alias',
        'unalias',
        'config',
        'doctor',
        'index',
        'init',
        'completions'
    )

    $commandAst.CommandElements | Select-Object -Skip 1 -First 1 | ForEach-Object {
        $subcommand = $_.Value

        switch ($subcommand) {
            'completions' {
                @('bash', 'zsh', 'fish', 'powershell') | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {
                    [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)
                }
            }
            'config' {
                @('get', 'set') | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {
                    [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)
                }
            }
            default {
                $commands | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {
                    [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)
                }
            }
        }
    }
}
`;
}

/**
 * Generate shell completions
 */
function generateCompletions(shell: ShellType): void {
  let output: string;

  switch (shell) {
    case "bash":
      output = generateBashCompletions();
      break;
    case "zsh":
      output = generateZshCompletions();
      break;
    case "fish":
      output = generateFishCompletions();
      break;
    case "powershell":
      output = generatePowerShellCompletions();
      break;
    default:
      console.error(chalk.red(`Unknown shell: ${shell}`));
      console.error(
        chalk.yellow("Supported shells: bash, zsh, fish, powershell")
      );
      process.exit(1);
  }

  console.log(output);
}

/**
 * Register the completions command
 */
export function registerCompletionsCommand(program: Command): void {
  program
    .command("completions <shell>")
    .description("Generate shell completions")
    .action((shell: string) => {
      const validShells: ShellType[] = ["bash", "zsh", "fish", "powershell"];
      if (!validShells.includes(shell as ShellType)) {
        console.error(chalk.red(`Unknown shell: ${shell}`));
        console.error(
          chalk.yellow("Supported shells: bash, zsh, fish, powershell")
        );
        process.exit(1);
      }
      generateCompletions(shell as ShellType);
    });
}
