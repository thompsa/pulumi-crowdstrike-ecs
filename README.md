# pulumi-crowdstrike-ecs

Add a Pulumi stack transform which modifies all `aws:ecs/taskDefinition:TaskDefinition` resources to add the Falcon Container and patch the container definitions to launch the falcon process.

This follows the instructions at  https://github.com/CrowdStrike/Container-Security/blob/main/aws-ecs/ecs-fargate-guide.md and replaces Step 6. You will still need to download the latest falcon containers in steps 1-5 and push to an ECR repo. Put the falcon container tag you have pushed in to your Pulumi config

```yaml
config:
  falcon:cid: XXXXXXXXXXXXXXXXXXXXXXXXXXXXXX-YY
  falcon:tag: 7.00.container.x86_64.Release
```

